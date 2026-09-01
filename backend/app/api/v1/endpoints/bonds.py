from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date
from pydantic import BaseModel
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/bonds", tags=["Bonds"])

class BondCreate(BaseModel):
    opp_id: int
    bond_type: str           # NEW_BOND, BID_BOND, FINAL_BOND
    bond_number: Optional[str] = None
    bond_amount: Optional[float] = None
    currency_id: int = 1
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    issuer_bank: Optional[str] = None
    beneficiary: Optional[str] = None
    notes: Optional[str] = None

class BondUpdate(BaseModel):
    bond_number: Optional[str] = None
    bond_amount: Optional[float] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    issuer_bank: Optional[str] = None
    beneficiary: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

@router.get("")
async def list_bonds(
    opp_id: Optional[int] = None,
    bond_type: Optional[str] = None,
    status: Optional[str] = None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    conds = ["1=1"]
    args = []
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
    await execute(conn, """
        INSERT INTO opportunity_bonds (opp_id, bond_type, bond_number, bond_amount, currency_id,
            issue_date, expiry_date, issuer_bank, beneficiary, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
        body.opp_id, body.bond_type, body.bond_number, body.bond_amount, body.currency_id,
        body.issue_date, body.expiry_date, body.issuer_bank, body.beneficiary,
        body.notes, current_user.user_id)
    return {"message": "Bond created"}

@router.get("/{bond_id}")
async def get_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    bond = await fetch_one(conn, "SELECT * FROM opportunity_bonds WHERE bond_id=$1", bond_id)
    if not bond: raise HTTPException(status_code=404, detail="Bond not found")
    return bond

@router.patch("/{bond_id}")
async def update_bond(bond_id: int, body: BondUpdate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    allowed = ["bond_number","bond_amount","issue_date","expiry_date","issuer_bank","beneficiary","status","notes"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(bond_id)
    await execute(conn, f"UPDATE opportunity_bonds SET {','.join(updates)} WHERE bond_id=${len(args)}", *args)
    return {"message": "Updated"}

@router.post("/{bond_id}/approve")
async def approve_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    await execute(conn, "UPDATE opportunity_bonds SET approved_by=$1, approved_at=NOW(), status='ISSUED' WHERE bond_id=$2",
        current_user.user_id, bond_id)
    return {"message": "Bond approved and issued"}

@router.delete("/{bond_id}")
async def delete_bond(bond_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    await execute(conn, "DELETE FROM opportunity_bonds WHERE bond_id=$1", bond_id)
    return {"message": "Deleted"}

@router.get("/stats/summary")
async def bond_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_one(conn, """
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN bond_type='NEW_BOND' THEN 1 END) AS new_bonds,
            COUNT(CASE WHEN bond_type='BID_BOND' THEN 1 END) AS bid_bonds,
            COUNT(CASE WHEN bond_type='FINAL_BOND' THEN 1 END) AS final_bonds,
            COUNT(CASE WHEN status='PENDING' THEN 1 END) AS pending,
            COUNT(CASE WHEN status='ISSUED' THEN 1 END) AS issued,
            COUNT(CASE WHEN expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7 THEN 1 END) AS expiring_soon
        FROM opportunity_bonds""")
