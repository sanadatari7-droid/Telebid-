from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import date, datetime
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/references", tags=["Company References"])

class RefCreate(BaseModel):
    company_name: str
    client_name: str
    project_name: str
    sales_rep_id: int
    presales_eng_id: int
    project_value: Optional[float] = None
    currency_id: int = 1
    industry: Optional[str] = None
    country: Optional[str] = None
    start_date: Optional[date] = None
    completion_date: Optional[date] = None
    description: Optional[str] = None

@router.get("")
async def list_refs(search:Optional[str]=None, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    args = [company_id]
    where = "cr.is_deleted=FALSE AND cr.company_id=$1"
    if search:
        args.append(f"%{search}%")
        where += f" AND (cr.company_name ILIKE ${len(args)} OR cr.client_name ILIKE ${len(args)} OR cr.project_name ILIKE ${len(args)})"
    sql = f"""SELECT cr.*,us.full_name AS sales_rep_name,up.full_name AS presales_name,c.currency_code,
                     (SELECT COUNT(*) FROM company_ref_versions v WHERE v.ref_id=cr.ref_id) AS version_count
              FROM company_references cr
              LEFT JOIN users us ON cr.sales_rep_id=us.user_id
              LEFT JOIN users up ON cr.presales_eng_id=up.user_id
              LEFT JOIN currencies c ON cr.currency_id=c.currency_id
              WHERE {where} ORDER BY cr.created_at DESC"""
    return await fetch_all(conn, sql, *args)

@router.post("", status_code=201)
async def create_ref(body:RefCreate, conn=Depends(get_db),
                     current_user=Depends(require_roles("ADMIN","SALES","PROCUREMENT"))):
    company_id = require_company(current_user)
    sales_name = await fetch_val(conn, "SELECT UPPER(REPLACE(full_name,' ','')) FROM users WHERE user_id=$1", body.sales_rep_id)
    client_code = body.client_name.upper().replace(" ","")[:10]
    ref_number = f"SLM-{(sales_name or 'UNKNOWN')[:10]}-{datetime.now().strftime('%Y%m%d')}-{client_code}-V1"
    await execute(conn,
        """INSERT INTO company_references (ref_number,company_name,client_name,project_name,
               sales_rep_id,presales_eng_id,project_value,currency_id,industry,country,
               start_date,completion_date,description,created_by,company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)""",
        ref_number, body.company_name, body.client_name, body.project_name,
        body.sales_rep_id, body.presales_eng_id, body.project_value, body.currency_id,
        body.industry, body.country, body.start_date, body.completion_date,
        body.description, current_user.user_id, company_id)
    return await fetch_one(conn, "SELECT * FROM company_references WHERE ref_number=$1 AND company_id=$2", ref_number, company_id)

@router.get("/{ref_id}")
async def get_ref(ref_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    ref = await fetch_one(conn, """
        SELECT cr.*,us.full_name AS sales_rep_name,up.full_name AS presales_name,c.currency_code
        FROM company_references cr
        LEFT JOIN users us ON cr.sales_rep_id=us.user_id
        LEFT JOIN users up ON cr.presales_eng_id=up.user_id
        LEFT JOIN currencies c ON cr.currency_id=c.currency_id
        WHERE cr.ref_id=$1 AND cr.is_deleted=FALSE AND cr.company_id=$2""", ref_id, company_id)
    if not ref: raise HTTPException(status_code=404, detail="Reference not found")
    versions = await fetch_all(conn,
        "SELECT v.*,u.full_name AS changed_by_name FROM company_ref_versions v JOIN users u ON v.changed_by=u.user_id WHERE v.ref_id=$1 ORDER BY v.version_number DESC",
        ref_id)
    return {"reference":ref,"version_history":versions}

@router.patch("/{ref_id}")
async def update_ref(ref_id:int, body:dict, conn=Depends(get_db),
                     current_user=Depends(require_roles("ADMIN","SALES","PROCUREMENT"))):
    company_id = require_company(current_user)
    old = await fetch_one(conn, "SELECT * FROM company_references WHERE ref_id=$1 AND company_id=$2", ref_id, company_id)
    if not old: raise HTTPException(status_code=404)
    await execute(conn,
        """INSERT INTO company_ref_versions (ref_id,version_number,company_name,client_name,project_name,project_value,description,change_summary,changed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Updated via API',$8)""",
        ref_id, old["current_version"], old["company_name"], old["client_name"],
        old["project_name"], old["project_value"], old["description"], current_user.user_id)
    updates = ["updated_at=NOW()", "updated_by=$1", "current_version=current_version+1"]
    args = [current_user.user_id]
    allowed = ["company_name","client_name","project_name","project_value","industry","country","description"]
    for k,v in body.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    args.append(ref_id); args.append(company_id)
    await execute(conn, f"UPDATE company_references SET {','.join(updates)} WHERE ref_id=${len(args)-1} AND company_id=${len(args)}", *args)
    return {"message": "Reference updated and new version created"}
