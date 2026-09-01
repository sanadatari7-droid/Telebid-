from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/employees", tags=["Employees"])

class EmpCreate(BaseModel):
    user_id: Optional[int] = None
    employee_code: str
    full_name: str
    email: str
    department: Optional[str] = None
    job_title: Optional[str] = None
    employee_type: str
    tech_specialty: Optional[str] = None

class MappingCreate(BaseModel):
    sales_emp_id: int
    presales_emp_id: int

@router.get("")
async def list_employees(employee_type:Optional[str]=None, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    sql = "SELECT e.* FROM employees e WHERE e.is_active=TRUE AND e.company_id=$1"
    args = [company_id]
    if employee_type:
        args.append(employee_type); sql += f" AND e.employee_type=${len(args)}"
    sql += " ORDER BY e.full_name"
    return await fetch_all(conn, sql, *args)

@router.post("", status_code=201)
async def create_employee(body:EmpCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await execute(conn,
        "INSERT INTO employees (user_id,employee_code,full_name,email,department,job_title,employee_type,tech_specialty,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        body.user_id, body.employee_code, body.full_name, body.email,
        body.department, body.job_title, body.employee_type, body.tech_specialty, company_id)
    return {"message": "Employee created"}

@router.get("/mappings")
async def list_mappings(conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT spm.*,
               es.full_name AS sales_name, es.email AS sales_email, es.employee_code AS sales_code,
               ep.full_name AS presales_name, ep.email AS presales_email, ep.tech_specialty,
               u.full_name AS created_by_name
        FROM sales_presales_mapping spm
        JOIN employees es ON spm.sales_emp_id=es.emp_id
        JOIN employees ep ON spm.presales_emp_id=ep.emp_id
        JOIN users u ON spm.created_by=u.user_id
        WHERE es.company_id=$1
        ORDER BY es.full_name""", company_id)

@router.post("/mappings", status_code=201)
async def create_mapping(body:MappingCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    sales_ok = await fetch_val(conn, "SELECT emp_id FROM employees WHERE emp_id=$1 AND company_id=$2", body.sales_emp_id, company_id)
    presales_ok = await fetch_val(conn, "SELECT emp_id FROM employees WHERE emp_id=$1 AND company_id=$2", body.presales_emp_id, company_id)
    if not sales_ok or not presales_ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    await execute(conn,
        "UPDATE sales_presales_mapping SET is_active=FALSE WHERE sales_emp_id=$1", body.sales_emp_id)
    await execute(conn,
        "INSERT INTO sales_presales_mapping (sales_emp_id,presales_emp_id,created_by) VALUES ($1,$2,$3)",
        body.sales_emp_id, body.presales_emp_id, current_user.user_id)
    return {"message": "Mapping created"}

@router.delete("/mappings/{mapping_id}")
async def delete_mapping(mapping_id:int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    owned = await fetch_val(conn,
        "SELECT spm.mapping_id FROM sales_presales_mapping spm JOIN employees es ON spm.sales_emp_id=es.emp_id WHERE spm.mapping_id=$1 AND es.company_id=$2",
        mapping_id, company_id)
    if not owned:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await execute(conn, "UPDATE sales_presales_mapping SET is_active=FALSE WHERE mapping_id=$1", mapping_id)
    return {"message": "Mapping deactivated"}

class EmpProfileUpdate(BaseModel):
    initials: Optional[str] = None
    sectors_covered: Optional[str] = None
    job_title: Optional[str] = None
    employee_type: Optional[str] = None

@router.patch("/{emp_id}/profile")
async def update_employee_profile(emp_id: int, body: EmpProfileUpdate,
    conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    allowed = {"initials","sectors_covered","job_title","employee_type"}
    updates, args = [], []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(emp_id); args.append(company_id)
    result = await execute(conn, f"UPDATE employees SET {','.join(updates)} WHERE emp_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Profile updated"}

@router.get("/sectors")
async def list_sectors(conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Distinct sectors from all employees for dropdown."""
    company_id = require_company(current_user)
    rows = await fetch_all(conn, "SELECT DISTINCT sectors_covered FROM employees WHERE sectors_covered IS NOT NULL AND sectors_covered != '' AND company_id=$1 ORDER BY sectors_covered", company_id)
    all_sectors = set()
    for r in rows:
        for s in (r["sectors_covered"] or "").split(","):
            s = s.strip()
            if s: all_sectors.add(s)
    return sorted(all_sectors)
