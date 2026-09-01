from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
from app.db.postgres import get_db, fetch_all, fetch_one, execute
from app.middleware.auth import get_current_user, require_roles, CurrentUser

router = APIRouter(prefix="/company-config", tags=["Company Config"])

class AMCreate(BaseModel):
    user_id: Optional[int] = None
    emp_id: Optional[int] = None
    full_name: str
    initials: Optional[str] = None
    email: Optional[str] = None

class BMCreate(BaseModel):
    user_id: Optional[int] = None
    emp_id: Optional[int] = None
    full_name: str
    initials: Optional[str] = None
    email: Optional[str] = None

class CompanyUpdate(BaseModel):
    company_name: Optional[str] = None
    company_name_ar: Optional[str] = None
    company_initials: Optional[str] = None
    activation_code: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None

@router.get("")
async def get_company(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_one(conn, "SELECT * FROM companies WHERE company_id=1")

@router.patch("")
async def update_company(body: CompanyUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    allowed = ["company_name","company_name_ar","company_initials","activation_code","address","phone","email","website"]
    updates, args = [], []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(1)
    await execute(conn, f"UPDATE companies SET {','.join(updates)} WHERE company_id=${len(args)}", *args)
    return {"message": "Company updated"}

# Account Managers
@router.get("/account-managers")
async def list_ams(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT * FROM company_account_managers WHERE company_id=1 AND is_active=TRUE ORDER BY full_name")

@router.post("/account-managers", status_code=201)
async def add_am(body: AMCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    # Auto-get initials from employee if emp_id provided
    initials = body.initials
    if body.emp_id and not initials:
        emp = await fetch_one(conn, "SELECT initials FROM employees WHERE emp_id=$1", body.emp_id)
        if emp: initials = emp["initials"]
    await execute(conn,
        "INSERT INTO company_account_managers (company_id, user_id, emp_id, full_name, initials, email) VALUES (1,$1,$2,$3,$4,$5)",
        body.user_id, body.emp_id, body.full_name, initials, body.email)
    return {"message": "Account manager added"}

@router.delete("/account-managers/{am_id}")
async def remove_am(am_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    await execute(conn, "UPDATE company_account_managers SET is_active=FALSE WHERE am_id=$1", am_id)
    return {"message": "Removed"}

# Bid Specialists / Managers
@router.get("/bid-managers")
async def list_bms(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT * FROM company_bid_managers WHERE company_id=1 AND is_active=TRUE ORDER BY full_name")

@router.post("/bid-managers", status_code=201)
async def add_bm(body: BMCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    initials = body.initials
    if body.emp_id and not initials:
        emp = await fetch_one(conn, "SELECT initials FROM employees WHERE emp_id=$1", body.emp_id)
        if emp: initials = emp["initials"]
    await execute(conn,
        "INSERT INTO company_bid_managers (company_id, user_id, emp_id, full_name, initials, email) VALUES (1,$1,$2,$3,$4,$5)",
        body.user_id, body.emp_id, body.full_name, initials, body.email)
    return {"message": "Bid manager added"}

@router.delete("/bid-managers/{bm_id}")
async def remove_bm(bm_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    await execute(conn, "UPDATE company_bid_managers SET is_active=FALSE WHERE bm_id=$1", bm_id)
    return {"message": "Removed"}
