from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from app.core.security import hash_password
from pydantic import BaseModel

router = APIRouter(prefix="/users", tags=["Users"])

class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    dept_id: Optional[int] = None
    job_title: Optional[str] = None
    phone: Optional[str] = None
    role_ids: list[int] = []

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    phone: Optional[str] = None
    dept_id: Optional[int] = None
    is_active: Optional[bool] = None

class PasswordReset(BaseModel):
    new_password: str

@router.get("/roles")
async def list_roles(conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    return await fetch_all(conn, "SELECT role_id, role_name, description FROM roles ORDER BY role_name")

@router.get("/departments")
async def list_depts(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT dept_id, dept_name FROM departments ORDER BY dept_name")

@router.get("/me")
async def get_me(conn=Depends(get_db), current_user: CurrentUser=Depends(get_current_user)):
    user = await fetch_one(conn,
        "SELECT u.*, d.dept_name FROM users u LEFT JOIN departments d ON u.dept_id=d.dept_id WHERE u.user_id=$1",
        current_user.user_id)
    if user:
        user = dict(user)
        user.pop("password_hash", None)
    return user

@router.get("")
async def list_users(page: int=Query(1,ge=1), page_size: int=Query(50),
    search: Optional[str]=None, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    conds, args = ["u.company_id=$1"], [company_id]
    if search:
        args.append(f"%{search}%")
        conds.append(f"(u.full_name ILIKE ${len(args)} OR u.email ILIKE ${len(args)} OR u.username ILIKE ${len(args)})")
    where = " AND ".join(conds)
    sql = f"""SELECT u.user_id, u.username, u.email, u.full_name, u.job_title,
                     u.phone, u.is_active, u.is_locked, u.last_login, u.created_at,
                     u.dept_id, d.dept_name,
                     (SELECT STRING_AGG(r.role_name,', ') FROM user_roles ur JOIN roles r ON ur.role_id=r.role_id WHERE ur.user_id=u.user_id) AS roles,
                     (SELECT ARRAY_AGG(ur.role_id) FROM user_roles ur WHERE ur.user_id=u.user_id) AS role_ids
              FROM users u LEFT JOIN departments d ON u.dept_id=d.dept_id
              WHERE {where} ORDER BY u.full_name"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("", status_code=201)
async def create_user(body: UserCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    # username/email are the login identifiers and must stay globally unique
    # (login has no company selector), so this check is intentionally not
    # scoped to company_id.
    existing = await fetch_one(conn, "SELECT user_id FROM users WHERE username=$1 OR email=$2", body.username, body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already exists")
    pw_hash = hash_password(body.password)
    await execute(conn,
        "INSERT INTO users (username,email,password_hash,full_name,dept_id,job_title,phone,created_by,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        body.username, body.email, pw_hash, body.full_name, body.dept_id, body.job_title, body.phone, current_user.user_id, company_id)
    uid = await fetch_val(conn, "SELECT user_id FROM users WHERE username=$1", body.username)
    for rid in body.role_ids:
        await execute(conn, "INSERT INTO user_roles (user_id,role_id,assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", uid, rid, current_user.user_id)
    try:
        await execute(conn, "INSERT INTO audit_logs (user_id,action,entity_type,entity_id,details,company_id) VALUES ($1,'USER_CREATED','user',$2,$3,$4)",
            current_user.user_id, uid, f"Created user: {body.username}", company_id)
    except Exception:
        pass
    return {"message": "User created", "user_id": uid}

@router.get("/{user_id}")
async def get_user(user_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    user = await fetch_one(conn, """
        SELECT u.user_id, u.username, u.email, u.full_name, u.job_title,
               u.phone, u.is_active, u.is_locked, u.last_login, u.created_at,
               u.dept_id, d.dept_name,
               ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS role_ids
        FROM users u LEFT JOIN departments d ON u.dept_id=d.dept_id
        LEFT JOIN user_roles ur ON u.user_id=ur.user_id
        WHERE u.user_id=$1 AND u.company_id=$2 GROUP BY u.user_id, d.dept_name""", user_id, company_id)
    if not user: raise HTTPException(status_code=404, detail="User not found")
    return user

@router.patch("/{user_id}")
async def update_user(user_id: int, body: UserUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    allowed = ["full_name","email","job_title","phone","dept_id","is_active"]
    updates, args = [], []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(user_id); args.append(company_id)
    result = await execute(conn, f"UPDATE users SET {','.join(updates)} WHERE user_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Updated"}

@router.patch("/{user_id}/roles")
async def update_roles(user_id: int, body: dict, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    owned = await fetch_val(conn, "SELECT user_id FROM users WHERE user_id=$1 AND company_id=$2", user_id, company_id)
    if not owned: raise HTTPException(status_code=404, detail="User not found")
    role_ids = body.get("role_ids", [])
    await execute(conn, "DELETE FROM user_roles WHERE user_id=$1", user_id)
    for rid in role_ids:
        await execute(conn, "INSERT INTO user_roles (user_id,role_id,assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", user_id, rid, current_user.user_id)
    return {"message": "Roles updated"}

@router.patch("/{user_id}/reset-password")
async def reset_password(user_id: int, body: PasswordReset, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    result = await execute(conn, "UPDATE users SET password_hash=$1, failed_attempts=0, is_locked=FALSE WHERE user_id=$2 AND company_id=$3",
        hash_password(body.new_password), user_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Password reset"}

@router.patch("/{user_id}/lock")
async def lock_user(user_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE users SET is_locked=TRUE WHERE user_id=$1 AND company_id=$2", user_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Locked"}

@router.patch("/{user_id}/unlock")
async def unlock_user(user_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE users SET is_locked=FALSE, failed_attempts=0 WHERE user_id=$1 AND company_id=$2", user_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Unlocked"}

@router.patch("/{user_id}/deactivate")
async def deactivate_user(user_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    result = await execute(conn, "UPDATE users SET is_active=FALSE WHERE user_id=$1 AND company_id=$2", user_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Deactivated"}

@router.patch("/{user_id}/activate")
async def activate_user(user_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE users SET is_active=TRUE WHERE user_id=$1 AND company_id=$2", user_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Activated"}
