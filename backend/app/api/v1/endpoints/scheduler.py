from fastapi import APIRouter, Depends
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val
from app.middleware.auth import require_roles, get_current_user, CurrentUser
from app.services.email_service import (
    send_deadline_reminder, send_bid_notification, send_bond_reminder
)
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scheduler", tags=["Scheduler"])


@router.post("/send-deadline-reminders")
async def send_deadline_reminders(
    conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    """
    Manually trigger all deadline reminders.
    In production this should be called daily by a cron job / APScheduler.
    Handles:
      1. Standard bid submission deadline reminders (7-day window)
      2. Bid bond reminders (6 days before submission deadline) when bond_required=TRUE
    """
    results = {"bid_reminders_sent": 0, "bond_reminders_sent": 0, "errors": []}

    # ── 1. Standard bid deadline reminders ────────────────────────────────────
    upcoming_bids = await fetch_all(conn, """
        SELECT b.bid_id, b.bid_number, b.bid_title, b.submission_deadline,
               EXTRACT(DAY FROM b.submission_deadline - NOW())::INT AS days_left,
               u.email, u.full_name, u.user_id
        FROM bids b
        JOIN users u ON b.created_by = u.user_id
        JOIN bid_statuses bs ON b.status_id = bs.status_id
        WHERE b.is_deleted = FALSE
          AND bs.status_code IN ('OPEN','PUBLISHED','PENDING_APPROVAL')
          AND b.submission_deadline BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        ORDER BY b.submission_deadline""")

    for bid in upcoming_bids:
        if bid["email"] and bid["days_left"] is not None:
            ok = await send_deadline_reminder(
                bid["email"], bid["full_name"],
                bid["bid_number"], bid["bid_title"], bid["days_left"])
            if ok:
                results["bid_reminders_sent"] += 1
                await execute(conn,
                    """INSERT INTO notifications (user_id, notif_type, title, body, related_bid)
                       VALUES ($1, 'DEADLINE_REMINDER', $2, $3, $4)""",
                    bid["user_id"],
                    f"Deadline reminder: {bid['bid_number']}",
                    f"{bid['days_left']} days until submission deadline",
                    bid["bid_id"])

    # ── 2. Bond reminders — 6 days before submission deadline ─────────────────
    bond_opps = await fetch_all(conn, """
        SELECT o.opp_id, o.opp_number, o.customer_name, o.submission_deadline,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_left,
               o.bond_required, o.bond_reminder_sent,
               -- Bid person (sales rep or bid manager)
               bp.user_id AS bid_person_id, bp.full_name AS bid_person_name, bp.email AS bid_person_email,
               -- Manager (bid_manager_id or manager_id)
               mgr.user_id AS manager_user_id, mgr.full_name AS manager_name, mgr.email AS manager_email
        FROM opportunities_v2 o
        LEFT JOIN users bp ON (o.bid_manager_id = bp.user_id OR o.sales_rep_id = bp.user_id)
        LEFT JOIN users mgr ON o.manager_id = mgr.user_id
        WHERE o.is_deleted = FALSE
          AND o.bond_required = TRUE
          AND o.bond_reminder_sent = FALSE
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
          AND o.submission_deadline IS NOT NULL
          AND EXTRACT(DAY FROM o.submission_deadline - NOW())::INT BETWEEN 0 AND 6
        ORDER BY o.submission_deadline""")

    for opp in bond_opps:
        days_left = opp["days_left"]
        if days_left is None or days_left < 0:
            continue

        deadline_str = opp["submission_deadline"].strftime("%d %B %Y %H:%M") if opp["submission_deadline"] else "N/A"
        any_sent = False

        # Send to bid person (bid_manager or sales_rep)
        if opp["bid_person_email"]:
            ok = await send_bond_reminder(
                to=opp["bid_person_email"],
                full_name=opp["bid_person_name"],
                opp_number=opp["opp_number"],
                customer_name=opp["customer_name"],
                submission_deadline=deadline_str,
                days_left=days_left,
                role="BID_PERSON")
            if ok:
                any_sent = True
                results["bond_reminders_sent"] += 1
                # In-app notification for bid person
                await execute(conn,
                    """INSERT INTO notifications
                       (user_id, notif_type, title, body)
                       VALUES ($1, 'BOND_REMINDER', $2, $3)""",
                    opp["bid_person_id"],
                    f"⚠️ Bond Required: {opp['opp_number']}",
                    f"Please request the bid bond for {opp['customer_name']}. "
                    f"Submission deadline is in {days_left} day(s).")

        # Send to manager (separate email with manager-tone)
        if opp["manager_email"] and opp["manager_user_id"] != opp["bid_person_id"]:
            ok_mgr = await send_bond_reminder(
                to=opp["manager_email"],
                full_name=opp["manager_name"],
                opp_number=opp["opp_number"],
                customer_name=opp["customer_name"],
                submission_deadline=deadline_str,
                days_left=days_left,
                role="MANAGER")
            if ok_mgr:
                any_sent = True
                results["bond_reminders_sent"] += 1
                # In-app notification for manager
                await execute(conn,
                    """INSERT INTO notifications
                       (user_id, notif_type, title, body)
                       VALUES ($1, 'BOND_REMINDER_MGR', $2, $3)""",
                    opp["manager_user_id"],
                    f"⚠️ [Manager] Bond Required: {opp['opp_number']}",
                    f"Bond request needed for {opp['customer_name']} — "
                    f"{days_left} day(s) until submission deadline.")

        # Mark as reminded so we don't send again
        if any_sent:
            await execute(conn,
                "UPDATE opportunities_v2 SET bond_reminder_sent=TRUE, bond_reminder_sent_at=NOW() WHERE opp_id=$1",
                opp["opp_id"])

    logger.info(f"Scheduler run: {results}")
    return {
        "message": (
            f"Sent {results['bid_reminders_sent']} deadline reminder(s) and "
            f"{results['bond_reminders_sent']} bond reminder(s)."
        ),
        "details": results
    }


@router.post("/check-bond-reminders")
async def check_bond_reminders(
    conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    """
    Dry-run: shows which opportunities would receive bond reminders right now.
    Does NOT send anything.
    """
    pending = await fetch_all(conn, """
        SELECT o.opp_id, o.opp_number, o.customer_name, o.submission_deadline,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_left,
               o.bond_reminder_sent,
               bp.full_name AS bid_person_name, bp.email AS bid_person_email,
               mgr.full_name AS manager_name, mgr.email AS manager_email
        FROM opportunities_v2 o
        LEFT JOIN users bp ON (o.bid_manager_id = bp.user_id OR o.sales_rep_id = bp.user_id)
        LEFT JOIN users mgr ON o.manager_id = mgr.user_id
        WHERE o.is_deleted = FALSE
          AND o.bond_required = TRUE
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
          AND o.submission_deadline IS NOT NULL
        ORDER BY o.submission_deadline""")

    return {
        "total_bond_required": len(pending),
        "pending_reminder": [p for p in pending if not p["bond_reminder_sent"] and (p["days_left"] or 99) <= 6],
        "reminder_sent": [p for p in pending if p["bond_reminder_sent"]],
        "upcoming": [p for p in pending if not p["bond_reminder_sent"] and (p["days_left"] or 99) > 6],
    }


@router.post("/notify-bid-event")
async def notify_bid_event(
    body: dict,
    conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    """Send email notification to all users assigned to a bid."""
    bid_id = body.get("bid_id")
    subject = body.get("subject", "TeleBid Notification")
    message = body.get("message", "")
    users = await fetch_all(conn, """
        SELECT DISTINCT u.user_id, u.email, u.full_name
        FROM users u
        WHERE u.user_id IN (
            SELECT created_by FROM bids WHERE bid_id=$1
            UNION SELECT approver_id FROM approvals WHERE bid_id=$1
            UNION SELECT evaluator_id FROM bid_evaluations WHERE bid_id=$1
        ) AND u.is_active=TRUE""", bid_id)
    bid_row = await fetch_one(conn, "SELECT bid_number FROM bids WHERE bid_id=$1", bid_id)
    bnr = bid_row["bid_number"] if bid_row else ""
    sent = 0
    for u in users:
        if u["email"]:
            ok = await send_bid_notification(u["email"], u["full_name"], subject, message, bnr)
            if ok:
                sent += 1
                await execute(conn,
                    "INSERT INTO notifications (user_id,notif_type,title,body,related_bid) VALUES ($1,'BID_EVENT',$2,$3,$4)",
                    u["user_id"], subject, message, bid_id)
    return {"message": f"Notified {sent} users"}
