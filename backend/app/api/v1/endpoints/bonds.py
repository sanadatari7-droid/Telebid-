from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date
from pydantic import BaseModel, Field
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/bonds", tags=["Bonds"])

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

class ApprovalRecord(BaseModel):
    approver_name: str

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
        SELECT b.*, o.opp_number, o.customer_name, c.symbol, c.currency_code,
               u.full_name AS created_by_name, a.full_name AS approved_by_name,
               (b.expiry_date - CURRENT_DATE)::INT AS days_to_expiry
        FROM opportunity_bonds b
        LEFT JOIN opportunities_v2 o ON b.opp_id=o.opp_id
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
    # Same derive-don't-duplicate rule as create: if the request updates the
    # percentage or base value without also typing a new bond_amount, keep
    # bond_amount in sync with them rather than leaving a stale figure.
    if "bond_amount" not in data and ("lg_percentage" in data or "lg_base_value" in data):
        current = await fetch_one(conn, "SELECT lg_percentage, lg_base_value FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond_id, company_id)
        if current:
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

@router.post("/{bond_id}/approve-business-solution")
async def approve_business_solution(bond_id: int, body: ApprovalRecord, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """First sign-off in the request chain (Requester -> Business Solution -> CBO)
    before the bank issues the bond — matches the company's own request form."""
    company_id = require_company(current_user)
    result = await execute(conn,
        "UPDATE opportunity_bonds SET business_solution_approver=$1, business_solution_approved_at=NOW() WHERE bond_id=$2 AND company_id=$3",
        body.approver_name, bond_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bond not found")
    return {"message": "Business Solution approval recorded"}

@router.post("/{bond_id}/approve-cbo")
async def approve_cbo(bond_id: int, body: ApprovalRecord, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Second, final sign-off in the request chain, per the company's form."""
    company_id = require_company(current_user)
    result = await execute(conn,
        "UPDATE opportunity_bonds SET cbo_approver=$1, cbo_approved_at=NOW() WHERE bond_id=$2 AND company_id=$3",
        body.approver_name, bond_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bond not found")
    return {"message": "CBO approval recorded"}

@router.post("/{bond_id}/approve")
async def approve_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """The bank has actually issued the bond — distinct from the two internal
    sign-offs above, which happen before the request is even sent to the bank."""
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE opportunity_bonds SET approved_by=$1, approved_at=NOW(), status='ISSUED' WHERE bond_id=$2 AND company_id=$3",
        current_user.user_id, bond_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bond not found")
    return {"message": "Bond approved and issued"}

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
