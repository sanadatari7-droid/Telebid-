from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from typing import Optional
from datetime import date
from pydantic import BaseModel, Field
from decimal import Decimal
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from app.api.v1.endpoints.company_config import get_bond_approval_config
from app.services.email_service import send_bond_issuance_request, smtp_configured
from app.services.bond_letter import build_request_letter, letter_filename, DOCX_MIME

router = APIRouter(prefix="/bonds", tags=["Bonds"])

APPROVER_ROLES = ("ADMIN", "DEPT_MANAGER", "DIRECTOR")

# The request content the three levels sign off on. Once Level 1 has approved,
# these can't change — otherwise the office would receive figures nobody approved.
LOCKED_AFTER_APPROVAL = ["bond_amount", "lg_percentage", "lg_base_value", "beneficiary", "beneficiary_address",
                         "bid_ref", "bid_subject", "language", "submission_date", "expiry_date"]

# Statuses only the approval cycle may set; PATCH can only move a bond to the others.
CYCLE_STATUSES = {"PENDING", "APPROVED", "REQUESTED", "ISSUED"}

def _same(a, b) -> bool:
    a = None if a == "" else a
    b = None if b == "" else b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float, Decimal)) or isinstance(b, (int, float, Decimal)):
        return float(a) == float(b)
    return str(a) == str(b)

class BondCreate(BaseModel):
    opp_id: int
    bond_type: str           # NEW_BOND, BID_BOND, FINAL_BOND
    bond_number: Optional[str] = None
    bond_amount: Optional[float] = Field(None, ge=0)
    currency_id: int = 1
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    issuer_bank: Optional[str] = None
    beneficiary: Optional[str] = None
    notes: Optional[str] = None
    # Fields matching the company's own Bid Bond Request form (a formal L/G
    # request sent To/From named people before the bank issues the bond).
    bid_ref: Optional[str] = None              # company's own RFP reference, e.g. "SLM-RF: MAU-26-166-CP"
    bid_subject: Optional[str] = None
    beneficiary_address: Optional[str] = None
    lg_percentage: Optional[float] = Field(None, ge=0, le=100)  # e.g. 1.0 for "One Percent (1%)"
    lg_base_value: Optional[float] = Field(None, ge=0)      # the SR amount the percentage is taken of
    language: Optional[str] = "Arabic"
    submission_date: Optional[date] = None
    requester_name: Optional[str] = None       # "From"
    recipient_name: Optional[str] = None       # "To"

class BondUpdate(BaseModel):
    bond_number: Optional[str] = None
    bond_amount: Optional[float] = Field(None, ge=0)
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    issuer_bank: Optional[str] = None
    beneficiary: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    bid_ref: Optional[str] = None
    bid_subject: Optional[str] = None
    beneficiary_address: Optional[str] = None
    lg_percentage: Optional[float] = Field(None, ge=0, le=100)
    lg_base_value: Optional[float] = Field(None, ge=0)
    language: Optional[str] = None
    submission_date: Optional[date] = None
    requester_name: Optional[str] = None
    recipient_name: Optional[str] = None

@router.get("")
async def list_bonds(
    opp_id: Optional[int] = None,
    bond_type: Optional[str] = None,
    status: Optional[str] = None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conds = ["b.company_id=$1"]
    args = [company_id]
    if opp_id:
        args.append(opp_id); conds.append(f"b.opp_id=${len(args)}")
    if bond_type:
        args.append(bond_type); conds.append(f"b.bond_type=${len(args)}")
    if status:
        args.append(status); conds.append(f"b.status=${len(args)}")
    where = " AND ".join(conds)
    return await fetch_all(conn, f"""
        SELECT b.*, COALESCE(o.opp_number, ri.rfp_number) AS opp_number,
               COALESCE(o.customer_name, cl.name_en) AS customer_name, c.symbol, c.currency_code,
               u.full_name AS created_by_name, a.full_name AS approved_by_name,
               (b.expiry_date - CURRENT_DATE)::INT AS days_to_expiry
        FROM opportunity_bonds b
        LEFT JOIN opportunities_v2 o ON b.opp_id=o.opp_id
        LEFT JOIN rfp_ict ri ON b.rfp_ict_id=ri.rfp_id
        LEFT JOIN clients cl ON ri.client_id=cl.client_id
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        LEFT JOIN users u ON b.created_by=u.user_id
        LEFT JOIN users a ON b.approved_by=a.user_id
        WHERE {where} ORDER BY b.created_at DESC""", *args)

@router.post("", status_code=201)
async def create_bond(body: BondCreate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp_ok = await fetch_val(conn, "SELECT opp_id FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", body.opp_id, company_id)
    if not opp_ok: raise HTTPException(status_code=404, detail="Opportunity not found")

    # bond_amount is the source of truth for reporting/KPIs — when the L/G
    # percentage + base value are given (the form's actual "1% of SR X"
    # phrasing) and no explicit amount was typed, derive it so it can never
    # drift from the percentage the request document itself specifies.
    bond_amount = body.bond_amount
    if bond_amount is None and body.lg_percentage is not None and body.lg_base_value is not None:
        bond_amount = round(body.lg_base_value * body.lg_percentage / 100, 2)

    await execute(conn, """
        INSERT INTO opportunity_bonds (opp_id, bond_type, bond_number, bond_amount, currency_id,
            issue_date, expiry_date, issuer_bank, beneficiary, notes, created_by, company_id,
            bid_ref, bid_subject, beneficiary_address, lg_percentage, lg_base_value, language,
            submission_date, requester_name, recipient_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)""",
        body.opp_id, body.bond_type, body.bond_number, bond_amount, body.currency_id,
        body.issue_date, body.expiry_date, body.issuer_bank, body.beneficiary,
        body.notes, current_user.user_id, company_id,
        body.bid_ref, body.bid_subject, body.beneficiary_address, body.lg_percentage,
        body.lg_base_value, body.language, body.submission_date, body.requester_name,
        body.recipient_name)
    return {"message": "Bond created"}

@router.get("/{bond_id}")
async def get_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    bond = await fetch_one(conn, "SELECT * FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
    if not bond: raise HTTPException(status_code=404, detail="Bond not found")
    return bond

@router.patch("/{bond_id}")
async def update_bond(bond_id: int, body: BondUpdate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    allowed = ["bond_number","bond_amount","issue_date","expiry_date","issuer_bank","beneficiary","status","notes",
               "bid_ref","bid_subject","beneficiary_address","lg_percentage","lg_base_value","language",
               "submission_date","requester_name","recipient_name"]
    data = body.dict(exclude_none=True)
    current = await fetch_one(conn, f"SELECT status, approval_level, {', '.join(LOCKED_AFTER_APPROVAL)} FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
    if not current: raise HTTPException(status_code=404, detail="Bond not found")
    if "status" in data and data["status"] != current["status"] and data["status"] in CYCLE_STATUSES:
        raise HTTPException(status_code=400,
            detail=f"A bond can only become {data['status']} through the approval cycle")
    if (current["approval_level"] or 0) > 0:
        changed = [k for k in LOCKED_AFTER_APPROVAL if k in data and not _same(data[k], current[k])]
        if changed:
            raise HTTPException(status_code=400,
                detail=f"This request has already been approved, so these can't be changed: {', '.join(changed)}")
    # Same derive-don't-duplicate rule as create: if the request updates the
    # percentage or base value without also typing a new bond_amount, keep
    # bond_amount in sync with them rather than leaving a stale figure.
    if "bond_amount" not in data and ("lg_percentage" in data or "lg_base_value" in data):
        pct = data.get("lg_percentage", current["lg_percentage"])
        base = data.get("lg_base_value", current["lg_base_value"])
        if pct is not None and base is not None:
            data["bond_amount"] = round(float(base) * float(pct) / 100, 2)

    updates = ["updated_at=NOW()"]
    args = []
    for k, v in data.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(bond_id); args.append(company_id)
    result = await execute(conn, f"UPDATE opportunity_bonds SET {','.join(updates)} WHERE bond_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bond not found")
    return {"message": "Updated"}

async def _letter(conn, bond: dict, company_id: int, cfg: dict) -> bytes:
    decimals = await fetch_val(conn, "SELECT COALESCE(currency_decimals, 2) FROM companies WHERE company_id=$1", company_id)
    levels = [(cfg[f"l{i}_title"], bond.get(f"l{i}_approver_name"), bond.get(f"l{i}_approved_at")) for i in (1, 2, 3)]
    return build_request_letter(bond, cfg, levels, bond.get("currency_code") or "", decimals or 2, date.today())


@router.get("/{bond_id}/request-letter")
async def bond_request_letter(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """The bid bond request letter (Word), filled from the bond, showing the approvals so far."""
    company_id = require_company(current_user)
    bond = await fetch_one(conn, """
        SELECT b.*, c.currency_code FROM opportunity_bonds b
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        WHERE b.bond_id=$1 AND b.company_id=$2""", bond_id, company_id)
    if not bond: raise HTTPException(status_code=404, detail="Bond not found")
    content = await _letter(conn, bond, company_id, await get_bond_approval_config(conn, company_id))
    filename = letter_filename(bond)
    return Response(content, media_type=DOCX_MIME,
                    headers={"Content-Disposition": f"attachment; filename=\"{filename}\""})


async def _send_to_office(conn, bond_id: int, company_id: int) -> dict:
    """Email the approved request to the Bid Bond Issuance Office. On success the
    bond moves to REQUESTED; on failure the reason is stored so it shows on the bond."""
    cfg = await get_bond_approval_config(conn, company_id)
    error = None
    if not cfg.get("office_email"):
        error = "No issuance office email is set (Company Settings → Bid Bond Approval), so the request wasn't sent"
    elif not await smtp_configured(company_id):
        error = "Email isn't set up yet (System Settings → Email), so the request wasn't sent"
    else:
        bond = await fetch_one(conn, """
            SELECT b.*, COALESCE(o.opp_number, ri.rfp_number) AS opp_number,
                   COALESCE(o.customer_name, cl.name_en) AS customer_name, c.currency_code
            FROM opportunity_bonds b
            LEFT JOIN opportunities_v2 o ON b.opp_id=o.opp_id
            LEFT JOIN rfp_ict ri ON b.rfp_ict_id=ri.rfp_id
            LEFT JOIN clients cl ON ri.client_id=cl.client_id
            LEFT JOIN currencies c ON b.currency_id=c.currency_id
            WHERE b.bond_id=$1 AND b.company_id=$2""", bond_id, company_id)
        approvals = [(cfg[f"l{i}_title"], bond[f"l{i}_approver_name"], bond[f"l{i}_approved_at"]) for i in (1, 2, 3)]
        letter = await _letter(conn, bond, company_id, cfg)
        if not await send_bond_issuance_request(cfg["office_email"], cfg["office_name"], bond, approvals, company_id=company_id,
                                                attachments=[(letter_filename(bond), letter, DOCX_MIME)]):
            error = "The email server didn't accept the message — check the office address and email settings, then send again"

    if error:
        await execute(conn, "UPDATE opportunity_bonds SET office_send_error=$1 WHERE bond_id=$2 AND company_id=$3",
                      error, bond_id, company_id)
        return {"sent": False, "error": error}
    await execute(conn, """
        UPDATE opportunity_bonds SET status='REQUESTED', office_sent_at=NOW(), office_sent_to=$1,
               office_send_error=NULL, updated_at=NOW()
        WHERE bond_id=$2 AND company_id=$3""", cfg["office_email"], bond_id, company_id)
    return {"sent": True, "to": cfg["office_email"], "office_name": cfg["office_name"]}

@router.post("/{bond_id}/approve-level/{level}")
async def approve_bond_level(bond_id: int, level: int, conn=Depends(get_db),
                             current_user=Depends(require_roles(*APPROVER_ROLES))):
    """Bid bond approval cycle: Level 1 -> 2 -> 3, strictly in order. When Level 3
    approves, the request goes to the issuance office automatically (if enabled)."""
    company_id = require_company(current_user)
    if level not in (1, 2, 3): raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")
    bond = await fetch_one(conn, "SELECT status, approval_level, created_by FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2",
                           bond_id, company_id)
    if not bond: raise HTTPException(status_code=404, detail="Bond not found")
    if bond["status"] != "PENDING" or (bond["approval_level"] or 0) != level - 1:
        raise HTTPException(status_code=400, detail=f"This bond isn't waiting for Level {level} approval")
    if bond["created_by"] == current_user.user_id and "ADMIN" not in current_user.roles:
        raise HTTPException(status_code=403,
            detail="Maker-checker: you requested this bond, so someone else has to approve it")

    new_status = "APPROVED" if level == 3 else "PENDING"
    result = await execute(conn, f"""
        UPDATE opportunity_bonds SET approval_level=$1, l{level}_approved_by=$2, l{level}_approver_name=$3,
               l{level}_approved_at=NOW(), status=$4, updated_at=NOW()
        WHERE bond_id=$5 AND company_id=$6 AND status='PENDING' AND COALESCE(approval_level,0)=$7""",
        level, current_user.user_id, current_user.full_name, new_status, bond_id, company_id, level - 1)
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Someone else just recorded this approval — refresh and try again")

    response = {"message": f"Level {level} approved", "status": new_status}
    if level == 3:
        cfg = await get_bond_approval_config(conn, company_id)
        if cfg["auto_send"]:
            response["office"] = await _send_to_office(conn, bond_id, company_id)
            if response["office"]["sent"]:
                response["status"] = "REQUESTED"
    return response

@router.post("/{bond_id}/send-to-office")
async def send_bond_to_office(bond_id: int, conn=Depends(get_db), current_user=Depends(require_roles(*APPROVER_ROLES))):
    """Send (or re-send) a fully approved request to the issuance office."""
    company_id = require_company(current_user)
    status = await fetch_val(conn, "SELECT status FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
    if status is None: raise HTTPException(status_code=404, detail="Bond not found")
    if status not in ("APPROVED", "REQUESTED"):
        raise HTTPException(status_code=400, detail="Only a bond approved at all three levels can be sent to the issuance office")
    result = await _send_to_office(conn, bond_id, company_id)
    if not result["sent"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"message": f"Request sent to {result['office_name']}", **result}

@router.post("/{bond_id}/approve")
async def approve_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """The office/bank has actually issued the bond — only after the approval cycle."""
    company_id = require_company(current_user)
    result = await execute(conn, """
        UPDATE opportunity_bonds SET approved_by=$1, approved_at=NOW(), status='ISSUED', updated_at=NOW()
        WHERE bond_id=$2 AND company_id=$3 AND status IN ('APPROVED','REQUESTED')""",
        current_user.user_id, bond_id, company_id)
    if result == "UPDATE 0":
        exists = await fetch_val(conn, "SELECT 1 FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
        if not exists: raise HTTPException(status_code=404, detail="Bond not found")
        raise HTTPException(status_code=400, detail="A bond can only be marked issued after all three approval levels")
    return {"message": "Bond marked as issued"}

@router.delete("/{bond_id}")
async def delete_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    result = await execute(conn, "DELETE FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
    if result == "DELETE 0": raise HTTPException(status_code=404, detail="Bond not found")
    return {"message": "Deleted"}

@router.get("/stats/summary")
async def bond_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, """
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN bond_type='NEW_BOND' THEN 1 END) AS new_bonds,
            COUNT(CASE WHEN bond_type='BID_BOND' THEN 1 END) AS bid_bonds,
            COUNT(CASE WHEN bond_type='FINAL_BOND' THEN 1 END) AS final_bonds,
            COUNT(CASE WHEN status='PENDING' THEN 1 END) AS pending,
            COUNT(CASE WHEN status='ISSUED' THEN 1 END) AS issued,
            COUNT(CASE WHEN expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7 THEN 1 END) AS expiring_soon
        FROM opportunity_bonds WHERE company_id=$1""", company_id)
