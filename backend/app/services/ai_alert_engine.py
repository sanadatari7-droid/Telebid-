"""AI Alert Watchdog.

Scans a company's open opportunities for risk signals that don't already
have a dedicated reminder (deadline is generic, bond reminders are their
own flow) — a stalled opportunity nobody has touched in days, a deadline
closing in with no costing sheet priced yet, a high-value opportunity
going idle — and asks Claude to decide which of those signals are actually
worth interrupting someone's inbox for, writing a short human headline and
reason for each. Delivery goes out through the existing SMTP pipeline
(app/services/email_service.py), which can be pointed at Outlook/Office 365's
SMTP relay (smtp.office365.com:587) via SMTP_HOST — no separate Graph/OAuth
integration involved.

When ANTHROPIC_API_KEY isn't set, falls back to a deterministic rule (every
candidate signal is alerted at a fixed severity) so the feature still works
end-to-end in an unconfigured/demo environment — same graceful-degradation
pattern as app/services/ai_advisor.py.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

COOLDOWN_HOURS = 24          # don't re-alert the same opp+alert_type within this window
STALLED_DAYS = 7             # no updates in this many days = stalled
DEADLINE_RISK_DAYS = 5       # submission deadline this close = at risk
MISSING_COSTING_DAYS = 10    # deadline this close with no priced costing lines
HIGH_VALUE_TCV = 500000      # TCV above this + stalled = high-value idle

TERMINAL_STATUSES = ("WON", "LOST", "DROPPED", "CANCELLED")


def _is_active(status: Optional[str]) -> bool:
    return status not in TERMINAL_STATUSES

RULE_LABELS = {
    "DEADLINE_RISK": ("HIGH", "Submission deadline closing in with work still open"),
    "STALLED": ("MEDIUM", "No activity on this opportunity in over a week"),
    "MISSING_COSTING": ("HIGH", "Deadline approaching with no costing sheet priced"),
    "HIGH_VALUE_IDLE": ("CRITICAL", "High-value opportunity has gone idle"),
}


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


class AlertPick(BaseModel):
    opp_id: int = Field(description="opp_id of the opportunity, copied from the candidate list given")
    should_alert: bool = Field(description="True only if this genuinely warrants an interrupting email right now")
    severity: str = Field(description="One of: LOW, MEDIUM, HIGH, CRITICAL")
    headline: str = Field(description="One short sentence, plain language, suitable as an email subject line")
    reason: str = Field(description="1-2 sentences explaining why, grounded only in the data given")
    recommended_action: str = Field(description="One concrete next step the recipient should take")


class AlertPicks(BaseModel):
    picks: List[AlertPick]


def _detect_signals(opp: dict, now: datetime) -> List[str]:
    signals = []
    deadline = opp.get("submission_deadline")
    updated_at = opp.get("updated_at")
    status = opp.get("status")

    days_left = (deadline - now).total_seconds() / 86400 if deadline else None
    days_idle = (now - updated_at).total_seconds() / 86400 if updated_at else None

    if days_left is not None and 0 <= days_left <= DEADLINE_RISK_DAYS and _is_active(status):
        signals.append("DEADLINE_RISK")

    if days_idle is not None and days_idle >= STALLED_DAYS and _is_active(status):
        signals.append("STALLED")

    if (days_left is not None and 0 <= days_left <= MISSING_COSTING_DAYS
            and not opp.get("has_costing_lines") and _is_active(status)):
        signals.append("MISSING_COSTING")

    tcv = opp.get("tcv") or 0
    if tcv >= HIGH_VALUE_TCV and days_idle is not None and days_idle >= STALLED_DAYS and _is_active(status):
        signals.append("HIGH_VALUE_IDLE")

    return signals


def _build_prompt(candidates: List[dict]) -> str:
    lines = [
        "You are an alert-triage assistant for a telecom bid/tender management system.",
        "Below are opportunities that tripped one or more automated risk rules. For EACH",
        "one, decide whether it genuinely deserves an alert email right now, or whether it's",
        "noise (e.g. a low-value opportunity barely past a threshold). Ground every judgment",
        "ONLY in the data given — do not invent facts. Be selective: alert fatigue is real,",
        "so only pick should_alert=true for opportunities where inaction has a real cost.",
        "",
    ]
    for c in candidates:
        lines.append(
            f"- opp_id={c['opp_id']} | {c['opp_number']} | customer={c['customer_name']} | "
            f"status={c['status']} | TCV={c.get('tcv') or 'n/a'} | "
            f"days_left_to_deadline={c['days_left']:.1f} | days_since_update={c['days_idle']:.1f} | "
            f"has_priced_costing_sheet={c['has_costing_lines']} | "
            f"triggered_rules={','.join(c['signals'])}"
        )
    lines.append("")
    lines.append("Return one AlertPick per opp_id listed above.")
    return "\n".join(lines)


async def _ai_pick(candidates: List[dict]) -> List[dict]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    prompt = _build_prompt(candidates)
    response = await client.messages.parse(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=2048,
        system=(
            "You triage automated risk signals for a telecom bid/tender system and write "
            "short, actionable alert emails. Be candid and concrete, never generic filler."
        ),
        messages=[{"role": "user", "content": prompt}],
        output_format=AlertPicks,
    )
    return [p.model_dump() for p in response.parsed_output.picks if p.should_alert]


def _rule_based_pick(candidates: List[dict]) -> List[dict]:
    picks = []
    for c in candidates:
        primary = c["signals"][0]
        severity, base_reason = RULE_LABELS[primary]
        picks.append({
            "opp_id": c["opp_id"],
            "should_alert": True,
            "severity": severity,
            "headline": f"{base_reason}: {c['opp_number']}",
            "reason": (
                f"{base_reason} for {c['opp_number']} ({c['customer_name']}). "
                f"{c['days_left']:.0f} day(s) to deadline, "
                f"{c['days_idle']:.0f} day(s) since last update."
            ),
            "recommended_action": (
                "Price the costing sheet before submitting." if primary == "MISSING_COSTING"
                else "Review and advance this opportunity before the deadline."
            ),
        })
    return picks


async def scan(conn, company_id: int) -> dict:
    """Scan one company's open opportunities, decide which deserve an alert,
    email the assigned people, and log every alert sent (or would-have-sent
    in a dry run) to ai_alerts. Returns a summary dict."""
    from app.db.postgres import fetch_all, execute
    from app.services.email_service import send_ai_alert_email

    now = datetime.now(timezone.utc)

    rows = await fetch_all(conn, """
        SELECT o.opp_id, o.opp_number, o.customer_name, o.status, o.tcv,
               o.submission_deadline, o.updated_at,
               o.bid_manager_id, bm.full_name AS bid_manager_name, bm.email AS bid_manager_email,
               o.sales_rep_id, sr.full_name AS sales_rep_name, sr.email AS sales_rep_email,
               o.manager_id, mgr.full_name AS manager_name, mgr.email AS manager_email,
               EXISTS (
                   SELECT 1 FROM opportunity_costing_lines cl
                   JOIN opportunity_costing_sheets cs ON cl.costing_id = cs.costing_id
                   WHERE cs.opp_id = o.opp_id
               ) AS has_costing_lines
        FROM opportunities_v2 o
        LEFT JOIN users bm ON o.bid_manager_id = bm.user_id
        LEFT JOIN users sr ON o.sales_rep_id = sr.user_id
        LEFT JOIN users mgr ON o.manager_id = mgr.user_id
        WHERE o.is_deleted = FALSE AND o.company_id = $1
          AND o.status <> ALL($2::text[])
    """, company_id, list(TERMINAL_STATUSES))

    candidates = []
    for r in rows:
        signals = _detect_signals(dict(r), now)
        if not signals:
            continue
        deadline = r["submission_deadline"]
        updated_at = r["updated_at"]
        candidates.append({
            "opp_id": r["opp_id"], "opp_number": r["opp_number"], "customer_name": r["customer_name"],
            "status": r["status"], "tcv": float(r["tcv"]) if r["tcv"] is not None else None,
            "days_left": (deadline - now).total_seconds() / 86400 if deadline else 999.0,
            "days_idle": (now - updated_at).total_seconds() / 86400 if updated_at else 0.0,
            "has_costing_lines": r["has_costing_lines"], "signals": signals,
            "bid_manager_name": r["bid_manager_name"], "bid_manager_email": r["bid_manager_email"],
            "sales_rep_name": r["sales_rep_name"], "sales_rep_email": r["sales_rep_email"],
            "manager_name": r["manager_name"], "manager_email": r["manager_email"],
        })

    result = {"candidates_found": len(candidates), "alerts_sent": 0, "ai_used": is_configured(), "skipped_cooldown": 0}
    if not candidates:
        return result

    # De-dup: drop candidates alerted for ANY of their triggered signals within the cooldown window
    fresh = []
    for c in candidates:
        recent = await fetch_all(conn, """
            SELECT alert_type FROM ai_alerts
            WHERE company_id=$1 AND opp_id=$2 AND created_at > $3 AND alert_type = ANY($4::text[])
        """, company_id, c["opp_id"], now - timedelta(hours=COOLDOWN_HOURS), c["signals"])
        already = {r["alert_type"] for r in recent}
        remaining = [s for s in c["signals"] if s not in already]
        if not remaining:
            result["skipped_cooldown"] += 1
            continue
        c["signals"] = remaining
        fresh.append(c)

    if not fresh:
        return result

    try:
        picks = await _ai_pick(fresh) if is_configured() else _rule_based_pick(fresh)
    except Exception as e:
        logger.error(f"AI alert triage failed, falling back to rule-based: {e}")
        picks = _rule_based_pick(fresh)

    by_id = {c["opp_id"]: c for c in fresh}
    for pick in picks:
        c = by_id.get(pick["opp_id"])
        if not c:
            continue
        alert_type = c["signals"][0]

        recipients = []
        if c["bid_manager_email"]:
            recipients.append((c["bid_manager_email"], c["bid_manager_name"]))
        elif c["sales_rep_email"]:
            recipients.append((c["sales_rep_email"], c["sales_rep_name"]))
        if c["manager_email"] and c["manager_email"] not in [r[0] for r in recipients]:
            recipients.append((c["manager_email"], c["manager_name"]))

        sent_ok = False
        for email, name in recipients:
            ok = await send_ai_alert_email(
                to=email, full_name=name or "Team",
                headline=pick["headline"], reason=pick["reason"],
                recommended_action=pick["recommended_action"],
                severity=pick["severity"], opp_number=c["opp_number"],
                customer_name=c["customer_name"], ai_generated=is_configured(),
            )
            sent_ok = sent_ok or ok

        await execute(conn, """
            INSERT INTO ai_alerts (company_id, opp_id, alert_type, severity, headline, reason,
                                    recommended_action, ai_generated, recipients, sent_ok)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        """, company_id, c["opp_id"], alert_type, pick["severity"], pick["headline"], pick["reason"],
             pick["recommended_action"], is_configured(), ",".join(r[0] for r in recipients), sent_ok)

        if sent_ok:
            result["alerts_sent"] += 1

    return result
