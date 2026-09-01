from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from app.core.security import generate_invitation_code
from pydantic import BaseModel

router = APIRouter(prefix="/vendors", tags=["Vendors"])

class VendorCreate(BaseModel):
    company_name: str
    registration_no: Optional[str] = None
    tax_number: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    business_category: Optional[str] = None

@router.get("")
async def list_vendors(page:int=Query(1,ge=1), page_size:int=Query(20),
                       search:Optional[str]=None, is_blacklisted:Optional[bool]=None,
                       conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conditions = ["v.is_deleted=FALSE", "v.company_id=$1"]
    args = [company_id]
    if search:
        args.append(f"%{search}%"); conditions.append(f"(v.company_name ILIKE ${len(args)} OR v.email ILIKE ${len(args)})")
    if is_blacklisted is not None:
        args.append(is_blacklisted); conditions.append(f"v.is_blacklisted=${len(args)}")
    where = " AND ".join(conditions)
    sql = f"""SELECT v.*,
                     (SELECT COUNT(*) FROM invitations i WHERE i.vendor_id=v.vendor_id) AS total_invitations,
                     (SELECT COUNT(*) FROM contracts c WHERE c.vendor_id=v.vendor_id AND c.is_deleted=FALSE) AS total_contracts,
                     (SELECT ROUND(AVG(vp.eval_score)::numeric,2) FROM vendor_performance vp WHERE vp.vendor_id=v.vendor_id) AS avg_score
              FROM vendors v WHERE {where} ORDER BY v.company_name"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("", status_code=201)
async def create_vendor(body:VendorCreate, conn=Depends(get_db),
                        current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    existing = await fetch_one(conn,
        "SELECT vendor_id FROM vendors WHERE UPPER(company_name)=UPPER($1) AND is_deleted=FALSE AND company_id=$2",
        body.company_name, company_id)
    if existing: raise HTTPException(status_code=409, detail="Vendor already exists")
    await execute(conn,
        "INSERT INTO vendors (company_name,registration_no,tax_number,contact_person,email,phone,address,business_category,created_by,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        body.company_name, body.registration_no, body.tax_number, body.contact_person,
        body.email, body.phone, body.address, body.business_category, current_user.user_id, company_id)
    return await fetch_one(conn, "SELECT * FROM vendors WHERE company_name=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 1", body.company_name, company_id)

@router.get("/{vendor_id}")
async def get_vendor(vendor_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    vendor = await fetch_one(conn, "SELECT * FROM vendors WHERE vendor_id=$1 AND is_deleted=FALSE AND company_id=$2", vendor_id, company_id)
    if not vendor: raise HTTPException(status_code=404, detail="Vendor not found")
    performance = await fetch_all(conn, "SELECT * FROM vendor_performance WHERE vendor_id=$1 AND company_id=$2 ORDER BY evaluated_at DESC", vendor_id, company_id)
    contracts = await fetch_all(conn, "SELECT c.*,b.bid_number,b.bid_title FROM contracts c JOIN bids b ON c.bid_id=b.bid_id WHERE c.vendor_id=$1 AND c.is_deleted=FALSE AND c.company_id=$2 ORDER BY c.created_at DESC", vendor_id, company_id)
    return {"vendor":vendor,"performance_history":performance,"contracts":contracts}

@router.post("/{vendor_id}/blacklist")
async def blacklist(vendor_id:int, body:dict, conn=Depends(get_db),
                    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE vendors SET is_blacklisted=TRUE,blacklist_reason=$1 WHERE vendor_id=$2 AND company_id=$3", body.get("reason"), vendor_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Vendor blacklisted"}

@router.delete("/{vendor_id}/blacklist")
async def unblacklist(vendor_id:int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE vendors SET is_blacklisted=FALSE,blacklist_reason=NULL WHERE vendor_id=$1 AND company_id=$2", vendor_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Removed from blacklist"}

@router.post("/{vendor_id}/invite")
async def invite(vendor_id:int, body:dict, conn=Depends(get_db),
                 current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    vendor = await fetch_one(conn, "SELECT is_blacklisted,company_name FROM vendors WHERE vendor_id=$1 AND company_id=$2", vendor_id, company_id)
    if not vendor: raise HTTPException(status_code=404, detail="Vendor not found")
    if vendor["is_blacklisted"]: raise HTTPException(status_code=400, detail="Cannot invite blacklisted vendor")
    bid_ok = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", body["bid_id"], company_id)
    if not bid_ok: raise HTTPException(status_code=404, detail="Bid not found")
    inv_code = generate_invitation_code()
    await execute(conn,
        "INSERT INTO invitations (bid_id,vendor_id,inv_code,invited_by,company_id) VALUES ($1,$2,$3,$4,$5)",
        body["bid_id"], vendor_id, inv_code, current_user.user_id, company_id)
    return {"message": f"Invitation sent to {vendor['company_name']}", "inv_code": inv_code}

@router.post("/bulk-import", status_code=201)
async def bulk_import(body: list, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    """Import vendors from parsed Excel/CSV data sent as JSON array."""
    company_id = require_company(current_user)
    created = 0
    skipped = 0
    errors = []
    for row in body:
        company_name = row.get("company_name","").strip()
        if not company_name:
            skipped += 1
            continue
        existing = await fetch_one(conn,
            "SELECT vendor_id FROM vendors WHERE UPPER(company_name)=UPPER($1) AND is_deleted=FALSE AND company_id=$2",
            company_name, company_id)
        if existing:
            skipped += 1
            continue
        try:
            await execute(conn,
                """INSERT INTO vendors (company_name,registration_no,contact_person,email,phone,
                                       business_category,created_by,company_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                company_name,
                row.get("registration_no","") or None,
                row.get("contact_person","") or None,
                row.get("email","") or None,
                row.get("phone","") or None,
                row.get("business_category","") or None,
                current_user.user_id, company_id)
            created += 1
        except Exception as e:
            errors.append(f"{company_name}: {str(e)}")
    return {"created": created, "skipped": skipped, "errors": errors}
