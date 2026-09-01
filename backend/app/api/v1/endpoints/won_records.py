from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime
from pydantic import BaseModel, validator
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/won-records", tags=["Won Records"])

# ── Models ────────────────────────────────────────────────────────────────────

class WonComplete(BaseModel):
    """Fields filled by Bid Person to complete the WON record."""
    won_date: date
    po_date: Optional[date] = None
    order_number: Optional[str] = None
    order_summary: Optional[str] = None
    discount_applied: Optional[float] = None   # percentage
    invoice_status: str = "NOT_INVOICED"
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    invoice_amount: Optional[float] = None
    payment_terms: Optional[str] = None
    bid_person_notes: Optional[str] = None

    @validator("discount_applied")
    def discount_range(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError("Discount must be between 0 and 100")
        return v

    @validator("po_date")
    def po_date_valid(cls, v):
        if v and v > date.today():
            raise ValueError("PO Date cannot be in the future")
        return v


class WonUpdate(BaseModel):
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    order_number: Optional[str] = None
    order_summary: Optional[str] = None
    discount_applied: Optional[float] = None
    invoice_status: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    invoice_amount: Optional[float] = None
    payment_terms: Optional[str] = None
    bid_person_notes: Optional[str] = None
    won_status: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _gen_won_number(conn) -> str:
    year = datetime.now().year
    count = await fetch_val(conn, "SELECT COUNT(*) FROM won_records") or 0
    return f"WON-{year}-{str(count + 1).zfill(5)}"


def _calc_discount(tcv: float, discount_pct: float) -> tuple:
    """Returns (discount_amount, final_value)."""
    if not tcv or not discount_pct:
        return (None, tcv)
    discount_amount = round(tcv * discount_pct / 100, 2)
    final_value = round(tcv - discount_amount, 2)
    return (discount_amount, final_value)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/from-opportunity/{opp_id}", status_code=201)
async def create_won_from_opportunity(
    opp_id: int,
    body: WonComplete,
    conn=Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Main WON workflow trigger.
    1. Validates the original opportunity exists
    2. Prevents duplicate WON records
    3. Copies all fields from opportunity
    4. Adds Bid Person WON-specific fields
    5. Updates original opportunity status to WON
    6. Creates audit log entry
    """
    company_id = require_company(current_user)
    # 1. Validate original opportunity exists
    opp = await fetch_one(conn, """
        SELECT o.*, c.symbol, c.currency_code,
               sf.family_name, st.solution_name,
               sr.full_name AS sales_rep_name,
               ps.full_name AS presales_name,
               bm.full_name AS bid_manager_name
        FROM opportunities_v2 o
        LEFT JOIN currencies c ON o.currency_id = c.currency_id
        LEFT JOIN solution_families sf ON o.family_id = sf.family_id
        LEFT JOIN solution_types st ON o.solution_id = st.solution_id
        LEFT JOIN users sr ON o.sales_rep_id = sr.user_id
        LEFT JOIN users ps ON o.presales_id = ps.user_id
        LEFT JOIN users bm ON o.bid_manager_id = bm.user_id
        WHERE o.opp_id = $1 AND o.is_deleted = FALSE AND o.company_id = $2""", opp_id, company_id)

    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    # 2. Duplicate prevention — one WON record per opportunity
    existing = await fetch_val(conn,
        "SELECT won_id FROM won_records WHERE opp_id = $1 AND is_deleted = FALSE", opp_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A WON record already exists for this opportunity (WON ID: {existing}). "
                   "Cannot create duplicate.")

    # 3. Generate WON number
    won_number = await _gen_won_number(conn)

    # 4. Calculate discount
    tcv = opp.get("tcv")
    discount_amount, final_value = _calc_discount(
        float(tcv) if tcv else 0,
        body.discount_applied or 0
    )

    # 5. Insert WON record — copy from opp + Bid Person fields
    await execute(conn, """
        INSERT INTO won_records (
            opp_id, won_number, company_id,
            -- Copied from opportunity
            expro_ref, po_number, customer_name, customer_name_ar,
            customer_id, customer_ref, media_type, sla_type,
            bandwidth_mbps, quantity, sow_detail, solution_detail,
            family_id, solution_id, nrc, mrc, tcv, currency_id,
            contract_duration, coverage_study, project_size, location_text,
            sales_rep_id, presales_id, bid_manager_id, submission_deadline,
            -- Bid Person inputs
            won_date, po_date, order_number, order_summary,
            discount_applied, discount_amount, final_value,
            invoice_status, invoice_number, invoice_date,
            invoice_amount, payment_terms, bid_person_notes,
            won_by, won_status
        ) VALUES (
            $1, $2, $43,
            $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24,
            $25, $26, $27, $28,
            $29, $30, $31, $32,
            $33, $34, $35,
            $36, $37, $38,
            $39, $40, $41,
            $42, 'ACTIVE'
        )""",
        opp_id, won_number,
        # Copied — po_number isn't known yet at WON time (the customer hasn't
        # issued one); it's populated later via the update endpoint.
        opp.get("expro_ref"), None, opp.get("customer_name"), opp.get("customer_name_ar"),
        opp.get("customer_id"), opp.get("customer_ref"), opp.get("media_type"), opp.get("sla_type"),
        opp.get("bandwidth_mbps"), opp.get("quantity"), opp.get("sow_detail"), opp.get("solution_detail"),
        opp.get("family_id"), opp.get("solution_id"), opp.get("nrc"), opp.get("mrc"), opp.get("tcv"), opp.get("currency_id"),
        opp.get("contract_duration"), opp.get("coverage_study"), opp.get("project_size"), opp.get("location_text"),
        opp.get("sales_rep_id"), opp.get("presales_id"), opp.get("bid_manager_id"), opp.get("submission_deadline"),
        # Bid Person
        body.won_date, body.po_date, body.order_number, body.order_summary,
        body.discount_applied, discount_amount, final_value,
        body.invoice_status, body.invoice_number, body.invoice_date,
        body.invoice_amount, body.payment_terms, body.bid_person_notes,
        current_user.user_id, company_id)

    won_id = await fetch_val(conn, "SELECT won_id FROM won_records WHERE won_number = $1 AND company_id = $2", won_number, company_id)

    # 6. Update original opportunity status to WON (preserve all other data)
    await execute(conn,
        "UPDATE opportunities_v2 SET status='WON', phase='Won', won_date=$1, order_number=$2, updated_at=NOW(), updated_by=$3 WHERE opp_id=$4 AND company_id=$5",
        body.won_date, body.order_number, current_user.user_id, opp_id, company_id)

    # 7. Audit log
    await execute(conn,
        """INSERT INTO opportunity_logs
           (opp_id, action, field_name, old_value, new_value, performed_by, comments)
           VALUES ($1, 'STATUS_CHANGED_TO_WON', 'status', 'APPROVED', 'WON', $2, $3)""",
        opp_id, current_user.user_id,
        f"WON record created: {won_number} (ID: {won_id}). Order: {body.order_number or 'N/A'}. "
        f"Discount: {body.discount_applied or 0}%. Final value: {final_value or tcv}")

    # 8. In-app notification
    await execute(conn,
        "INSERT INTO notifications (user_id, notif_type, title, body, company_id) VALUES ($1, 'OPP_WON', $2, $3, $4)",
        current_user.user_id,
        f"🎉 Won: {opp['customer_name']}",
        f"Opportunity {opp.get('opp_number')} marked as WON. Record {won_number} created.",
        company_id)

    return {
        "won_id": won_id,
        "won_number": won_number,
        "opp_id": opp_id,
        "opp_number": opp.get("opp_number"),
        "customer_name": opp.get("customer_name"),
        "final_value": final_value,
        "message": f"WON record {won_number} created successfully"
    }


@router.get("")
async def list_won_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    search: Optional[str] = None,
    won_status: Optional[str] = None,
    invoice_status: Optional[str] = None,
    conn=Depends(get_db),
    current_user=Depends(get_current_user)
):
    company_id = require_company(current_user)
    conds = ["w.is_deleted = FALSE", "w.company_id = $1"]
    args = [company_id]
    if search:
        args.append(f"%{search}%")
        conds.append(f"(w.customer_name ILIKE ${len(args)} OR w.won_number ILIKE ${len(args)} OR w.expro_ref ILIKE ${len(args)} OR w.po_number ILIKE ${len(args)})")
    if won_status:
        args.append(won_status); conds.append(f"w.won_status=${len(args)}")
    if invoice_status:
        args.append(invoice_status); conds.append(f"w.invoice_status=${len(args)}")
    where = " AND ".join(conds)
    sql = f"""
        SELECT w.*,
               o.opp_number, o.status AS opp_status,
               sf.family_name, st.solution_name,
               c.symbol, c.currency_code,
               sr.full_name AS sales_rep_name,
               ps.full_name AS presales_name,
               bm.full_name AS bid_manager_name,
               wb.full_name AS won_by_name,
               cb.full_name AS completed_by_name
        FROM won_records w
        JOIN opportunities_v2 o ON w.opp_id = o.opp_id
        LEFT JOIN solution_families sf ON w.family_id = sf.family_id
        LEFT JOIN solution_types st ON w.solution_id = st.solution_id
        LEFT JOIN currencies c ON w.currency_id = c.currency_id
        LEFT JOIN users sr ON w.sales_rep_id = sr.user_id
        LEFT JOIN users ps ON w.presales_id = ps.user_id
        LEFT JOIN users bm ON w.bid_manager_id = bm.user_id
        LEFT JOIN users wb ON w.won_by = wb.user_id
        LEFT JOIN users cb ON w.completed_by = cb.user_id
        WHERE {where} ORDER BY w.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)


@router.get("/stats")
async def won_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, """
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(tcv), 0) AS total_tcv,
            COALESCE(SUM(final_value), 0) AS total_final_value,
            COALESCE(AVG(discount_applied), 0) AS avg_discount,
            COUNT(CASE WHEN invoice_status='PAID' THEN 1 END) AS paid,
            COUNT(CASE WHEN invoice_status='INVOICED' THEN 1 END) AS invoiced,
            COUNT(CASE WHEN invoice_status='PARTIAL' THEN 1 END) AS partial,
            COUNT(CASE WHEN invoice_status='NOT_INVOICED' THEN 1 END) AS not_invoiced,
            COALESCE(SUM(CASE WHEN invoice_status='PAID' THEN final_value END), 0) AS total_paid,
            COALESCE(SUM(CASE WHEN invoice_status != 'PAID' THEN final_value END), 0) AS total_outstanding
        FROM won_records WHERE is_deleted = FALSE AND won_status = 'ACTIVE' AND company_id = $1""", company_id)


@router.get("/{won_id}")
async def get_won_record(won_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    won = await fetch_one(conn, """
        SELECT w.*,
               o.opp_number, o.status AS opp_status, o.customer_ref AS opp_customer_ref,
               sf.family_name, sf.family_name_ar, st.solution_name,
               c.symbol, c.currency_code,
               sr.full_name AS sales_rep_name, sr.email AS sales_rep_email,
               ps.full_name AS presales_name, ps.email AS presales_email,
               bm.full_name AS bid_manager_name,
               wb.full_name AS won_by_name, wb.email AS won_by_email
        FROM won_records w
        JOIN opportunities_v2 o ON w.opp_id = o.opp_id
        LEFT JOIN solution_families sf ON w.family_id = sf.family_id
        LEFT JOIN solution_types st ON w.solution_id = st.solution_id
        LEFT JOIN currencies c ON w.currency_id = c.currency_id
        LEFT JOIN users sr ON w.sales_rep_id = sr.user_id
        LEFT JOIN users ps ON w.presales_id = ps.user_id
        LEFT JOIN users bm ON w.bid_manager_id = bm.user_id
        LEFT JOIN users wb ON w.won_by = wb.user_id
        WHERE w.won_id = $1 AND w.is_deleted = FALSE AND w.company_id = $2""", won_id, company_id)
    if not won:
        raise HTTPException(status_code=404, detail="WON record not found")
    # Get audit trail from opportunity
    logs = await fetch_all(conn, """
        SELECT ol.*, u.full_name AS performed_by_name
        FROM opportunity_logs ol
        LEFT JOIN users u ON ol.performed_by = u.user_id
        WHERE ol.opp_id = $1 AND ol.action LIKE '%WON%'
        ORDER BY ol.performed_at DESC""", won.get("opp_id"))
    return {"won_record": won, "audit_trail": logs}


@router.get("/by-opportunity/{opp_id}")
async def get_won_by_opp(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Get WON record linked to a specific opportunity."""
    company_id = require_company(current_user)
    won = await fetch_one(conn, "SELECT * FROM won_records WHERE opp_id = $1 AND is_deleted = FALSE AND company_id = $2", opp_id, company_id)
    return won  # Returns null if not yet won


@router.patch("/{won_id}")
async def update_won_record(
    won_id: int,
    body: WonUpdate,
    conn=Depends(get_db),
    current_user=Depends(get_current_user)
):
    company_id = require_company(current_user)
    won = await fetch_one(conn, "SELECT * FROM won_records WHERE won_id = $1 AND company_id = $2", won_id, company_id)
    if not won: raise HTTPException(status_code=404)

    allowed = ["po_number","po_date","order_number","order_summary","discount_applied",
               "invoice_status","invoice_number","invoice_date","invoice_amount",
               "payment_terms","bid_person_notes","won_status"]
    updates = ["updated_at=NOW()", f"completed_by={current_user.user_id}", "completed_at=NOW()"]
    args = []

    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")

    # Recalculate discount if relevant fields updated
    disc = body.discount_applied if body.discount_applied is not None else won.get("discount_applied")
    tcv = won.get("tcv")
    if disc is not None and tcv:
        disc_amt, final = _calc_discount(float(tcv), float(disc))
        args.append(disc_amt); updates.append(f"discount_amount=${len(args)}")
        args.append(final);    updates.append(f"final_value=${len(args)}")

    if not args:
        raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(won_id); args.append(company_id)
    await execute(conn, f"UPDATE won_records SET {','.join(updates)} WHERE won_id=${len(args)-1} AND company_id=${len(args)}", *args)

    # Audit
    await execute(conn,
        "INSERT INTO opportunity_logs (opp_id, action, performed_by, comments) VALUES ($1,'WON_RECORD_UPDATED',$2,$3)",
        won["opp_id"], current_user.user_id, f"WON record {won['won_number']} updated by {current_user.full_name}")

    return {"message": "WON record updated"}
