from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import date
from app.db.postgres import get_db, fetch_all, fetch_one, execute
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/contracts", tags=["Contracts"])

class ContractUpdate(BaseModel):
    contract_title: Optional[str] = None
    contract_value: Optional[float] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None

@router.get("")
async def list_contracts(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn,
        """SELECT c.*,b.bid_number,b.bid_title,v.company_name AS vendor_name,
                  v.contact_person,v.email AS vendor_email,
                  cu.currency_code,cu.symbol,
                  u.full_name AS created_by_name,
                  CASE WHEN c.end_date < NOW()::date THEN 'EXPIRED'
                       WHEN c.end_date < NOW()::date + INTERVAL '30 days' THEN 'EXPIRING_SOON'
                       ELSE c.status END AS display_status
           FROM contracts c
           JOIN bids b ON c.bid_id=b.bid_id
           JOIN vendors v ON c.vendor_id=v.vendor_id
           LEFT JOIN currencies cu ON c.currency_id=cu.currency_id
           LEFT JOIN users u ON c.created_by=u.user_id
           WHERE c.is_deleted=FALSE ORDER BY c.created_at DESC""")

@router.get("/{contract_id}")
async def get_contract(contract_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    c = await fetch_one(conn,
        """SELECT c.*,b.bid_number,b.bid_title,v.company_name AS vendor_name,
                  v.contact_person,v.email AS vendor_email,v.phone,
                  cu.currency_code,cu.symbol
           FROM contracts c JOIN bids b ON c.bid_id=b.bid_id
           JOIN vendors v ON c.vendor_id=v.vendor_id
           LEFT JOIN currencies cu ON c.currency_id=cu.currency_id
           WHERE c.contract_id=$1 AND c.is_deleted=FALSE""", contract_id)
    if not c: raise HTTPException(status_code=404, detail="Contract not found")
    docs = await fetch_all(conn,
        "SELECT * FROM documents WHERE bid_id=$1 AND is_deleted=FALSE ORDER BY uploaded_at DESC",
        c["bid_id"])
    return {"contract": c, "documents": docs}

@router.patch("/{contract_id}")
async def update_contract(contract_id: int, body: ContractUpdate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    updates, params = ["updated_at=NOW()"], []
    for f, v in body.model_dump(exclude_none=True).items():
        params.append(v); updates.append(f"{f}=${len(params)}")
    params.append(contract_id)
    await execute(conn, f"UPDATE contracts SET {','.join(updates)} WHERE contract_id=${len(params)}", *params)
    return {"message": "Contract updated"}

@router.post("/{contract_id}/sign")
async def sign_contract(contract_id: int, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","DIRECTOR"))):
    await execute(conn,
        "UPDATE contracts SET status='SIGNED',signed_at=NOW(),signed_by=$1 WHERE contract_id=$2",
        current_user.user_id, contract_id)
    return {"message": "Contract signed"}

@router.delete("/{contract_id}")
async def delete_contract(contract_id: int, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn, "UPDATE contracts SET is_deleted=TRUE WHERE contract_id=$1", contract_id)
    return {"message": "Contract archived"}
