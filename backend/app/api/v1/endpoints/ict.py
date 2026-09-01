from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel
from datetime import date

router = APIRouter(prefix="/ict", tags=["ICT Module"])

class ICTProjectCreate(BaseModel):
    bid_id: int
    ict_cat_id: int
    project_type: Optional[str] = None
    project_location: Optional[str] = None
    site_information: Optional[str] = None
    required_infrastructure: Optional[str] = None
    construction_requirements: Optional[str] = None
    technical_requirements: Optional[str] = None
    project_duration_days: Optional[int] = None
    project_duration_unit: str = "DAYS"
    contractor_vendor: Optional[str] = None
    estimated_value: Optional[float] = None
    currency_id: int = 1
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None

@router.get("")
async def list_ict(page: int=Query(1,ge=1), page_size: int=Query(20),
    search: Optional[str]=None, cat_code: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conditions = ["b.is_deleted=FALSE", "bm.module_code='NON_TELECOM'", "b.company_id=$1"]
    args = [company_id]
    if search:
        args.append(f"%{search}%")
        conditions.append(f"(b.bid_title ILIKE ${len(args)} OR b.bid_number ILIKE ${len(args)})")
    if cat_code:
        args.append(cat_code)
        conditions.append(f"ic.cat_code=${len(args)}")
    where = " AND ".join(conditions)
    sql = f"""
        SELECT b.bid_id, b.bid_number, b.bid_title, b.customer_name, b.organization,
               b.submission_deadline, b.budget, b.estimated_value, b.is_government,
               b.location_city, b.location_country,
               bs.status_code, bs.status_name, bs.color_hex,
               bm.module_name, bm.module_code,
               ic.cat_name AS ict_category, ic.cat_code, ic.has_construction,
               ip.ict_id, ip.project_duration_days, ip.contractor_vendor,
               ip.project_location, ip.status AS project_status,
               u.full_name AS bid_owner_name,
               c.symbol, c.currency_code
        FROM bids b
        JOIN bid_statuses bs ON b.status_id=bs.status_id
        JOIN bid_modules bm ON b.module_id=bm.module_id
        LEFT JOIN ict_projects ip ON ip.bid_id=b.bid_id
        LEFT JOIN ict_categories ic ON ip.ict_cat_id=ic.ict_cat_id
        LEFT JOIN users u ON b.bid_owner=u.user_id
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        WHERE {where}
        ORDER BY b.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("", status_code=201)
async def create_ict_project(body: ICTProjectCreate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    bid_ok = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", body.bid_id, company_id)
    if not bid_ok: raise HTTPException(status_code=404, detail="Bid not found")
    await execute(conn,
        """INSERT INTO ict_projects (bid_id, company_id, ict_cat_id, project_type,
            project_location, site_information, required_infrastructure,
            construction_requirements, technical_requirements,
            project_duration_days, project_duration_unit, contractor_vendor,
            estimated_value, currency_id, start_date, end_date, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)""",
        body.bid_id, company_id, body.ict_cat_id, body.project_type,
        body.project_location, body.site_information, body.required_infrastructure,
        body.construction_requirements, body.technical_requirements,
        body.project_duration_days, body.project_duration_unit, body.contractor_vendor,
        body.estimated_value, body.currency_id, body.start_date, body.end_date,
        body.notes, current_user.user_id)
    # Update bid module
    module_id = await fetch_val(conn, "SELECT module_id FROM bid_modules WHERE module_code='NON_TELECOM'")
    await execute(conn, "UPDATE bids SET module_id=$1 WHERE bid_id=$2 AND company_id=$3", module_id, body.bid_id, company_id)
    return await fetch_one(conn, "SELECT * FROM ict_projects WHERE bid_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 1", body.bid_id, company_id)

@router.get("/stats")
async def ict_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    by_cat = await fetch_all(conn, """
        SELECT ic.cat_name, ic.cat_code, ic.has_construction,
               COUNT(ip.ict_id) AS project_count,
               COALESCE(SUM(ip.estimated_value),0) AS total_value
        FROM ict_categories ic
        LEFT JOIN ict_projects ip ON ic.ict_cat_id=ip.ict_cat_id AND ip.company_id=$1
        WHERE ic.company_id=$1
        GROUP BY ic.cat_name, ic.cat_code, ic.has_construction
        ORDER BY project_count DESC""", company_id)
    totals = await fetch_one(conn, """
        SELECT COUNT(*) AS total,
               COUNT(CASE WHEN ic.has_construction THEN 1 END) AS construction_count,
               COALESCE(SUM(ip.estimated_value),0) AS total_value
        FROM ict_projects ip
        JOIN ict_categories ic ON ip.ict_cat_id=ic.ict_cat_id
        WHERE ip.company_id=$1""", company_id)
    return {"by_category": by_cat, "totals": totals}

@router.get("/{ict_id}")
async def get_ict(ict_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    project = await fetch_one(conn, """
        SELECT ip.*, b.bid_title, b.bid_number, b.customer_name, b.organization,
               ic.cat_name, ic.has_construction, u.full_name AS created_by_name
        FROM ict_projects ip
        JOIN bids b ON ip.bid_id=b.bid_id
        JOIN ict_categories ic ON ip.ict_cat_id=ic.ict_cat_id
        LEFT JOIN users u ON ip.created_by=u.user_id
        WHERE ip.ict_id=$1 AND ip.company_id=$2""", ict_id, company_id)
    if not project:
        raise HTTPException(status_code=404, detail="ICT project not found")
    return project

@router.patch("/{ict_id}")
async def update_ict(ict_id: int, body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    allowed = ["project_location","site_information","required_infrastructure",
               "construction_requirements","technical_requirements",
               "project_duration_days","contractor_vendor","estimated_value",
               "start_date","end_date","notes","status"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="No valid fields")
    args.append(ict_id); args.append(company_id)
    result = await execute(conn, f"UPDATE ict_projects SET {','.join(updates)} WHERE ict_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="ICT project not found")
    return {"message": "ICT project updated"}
