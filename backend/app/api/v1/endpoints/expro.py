from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/expro", tags=["EXPRO Module"])

class ExproLogCreate(BaseModel):
    bid_id: Optional[int] = None
    log_reference: Optional[str] = None
    notes: Optional[str] = None
    field_values: dict = {}

class FieldDefCreate(BaseModel):
    field_key: str
    field_label: str
    field_label_ar: Optional[str] = None
    field_type: str = "TEXT"
    dropdown_key: Optional[str] = None
    is_required: bool = False
    sort_order: int = 0

@router.get("/field-definitions")
async def get_field_defs(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn,
        "SELECT * FROM expro_field_definitions WHERE company_id=1 AND is_active=TRUE ORDER BY sort_order")

@router.post("/field-definitions")
async def add_field_def(body: FieldDefCreate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn,
        """INSERT INTO expro_field_definitions (company_id,field_key,field_label,field_label_ar,
           field_type,dropdown_key,is_required,sort_order)
           VALUES (1,$1,$2,$3,$4,$5,$6,$7)""",
        body.field_key, body.field_label, body.field_label_ar, body.field_type,
        body.dropdown_key, body.is_required, body.sort_order)
    return {"message": "Field definition added"}

@router.patch("/field-definitions/{field_def_id}")
async def update_field_def(field_def_id: int, body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    allowed = ["field_label","field_label_ar","field_type","dropdown_key","is_required","sort_order","is_active"]
    updates = []; args = []
    for k, v in body.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    args.append(field_def_id)
    await execute(conn, f"UPDATE expro_field_definitions SET {','.join(updates)} WHERE field_def_id=${len(args)}", *args)
    return {"message": "Field updated"}

@router.delete("/field-definitions/{field_def_id}")
async def delete_field_def(field_def_id: int, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn, "UPDATE expro_field_definitions SET is_active=FALSE WHERE field_def_id=$1", field_def_id)
    return {"message": "Field deactivated"}

@router.get("/logs")
async def list_logs(page: int=Query(1,ge=1), page_size: int=Query(20),
    bid_id: Optional[int]=None, status: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    conditions = ["el.company_id=1"]
    args = []
    if bid_id:
        args.append(bid_id); conditions.append(f"el.bid_id=${len(args)}")
    if status:
        args.append(status); conditions.append(f"el.status=${len(args)}")
    where = " AND ".join(conditions)
    sql = f"""SELECT el.*, b.bid_number, b.bid_title, b.customer_name,
                     u.full_name AS created_by_name,
                     us.full_name AS submitted_by_name, ur.full_name AS reviewed_by_name
              FROM expro_logs el
              LEFT JOIN bids b ON el.bid_id=b.bid_id
              LEFT JOIN users u ON el.created_by=u.user_id
              LEFT JOIN users us ON el.submitted_by=us.user_id
              LEFT JOIN users ur ON el.reviewed_by=ur.user_id
              WHERE {where} ORDER BY el.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("/logs", status_code=201)
async def create_log(body: ExproLogCreate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    # Generate reference
    count = await fetch_val(conn, "SELECT COUNT(*) FROM expro_logs") or 0
    from datetime import datetime
    ref = f"EXPRO-{datetime.now().year}-{str(count+1).zfill(5)}"
    await execute(conn,
        "INSERT INTO expro_logs (bid_id, company_id, log_reference, notes, created_by) VALUES ($1,1,$2,$3,$4)",
        body.bid_id, body.log_reference or ref, body.notes, current_user.user_id)
    log_id = await fetch_val(conn, "SELECT expro_log_id FROM expro_logs ORDER BY created_at DESC LIMIT 1")
    # Save field values
    field_defs = await fetch_all(conn, "SELECT * FROM expro_field_definitions WHERE company_id=1 AND is_active=TRUE")
    for fd in field_defs:
        val = body.field_values.get(fd["field_key"])
        if val is not None:
            await execute(conn,
                "INSERT INTO expro_log_values (expro_log_id, field_def_id, field_key, field_value) VALUES ($1,$2,$3,$4)",
                log_id, fd["field_def_id"], fd["field_key"], str(val))
    return {"message": "EXPRO log created", "expro_log_id": log_id, "log_reference": ref}

@router.get("/logs/{log_id}")
async def get_log(log_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    log = await fetch_one(conn, """
        SELECT el.*, b.bid_number, b.bid_title, u.full_name AS created_by_name
        FROM expro_logs el
        LEFT JOIN bids b ON el.bid_id=b.bid_id
        LEFT JOIN users u ON el.created_by=u.user_id
        WHERE el.expro_log_id=$1""", log_id)
    if not log: raise HTTPException(status_code=404)
    values = await fetch_all(conn, """
        SELECT elv.*, efd.field_label, efd.field_type, efd.field_label_ar
        FROM expro_log_values elv
        JOIN expro_field_definitions efd ON elv.field_def_id=efd.field_def_id
        WHERE elv.expro_log_id=$1 ORDER BY efd.sort_order""", log_id)
    return {"log": log, "values": values}

@router.patch("/logs/{log_id}/submit")
async def submit_log(log_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    # Check required fields
    required = await fetch_all(conn,
        "SELECT field_key, field_label FROM expro_field_definitions WHERE company_id=1 AND is_required=TRUE AND is_active=TRUE")
    filled = await fetch_all(conn,
        "SELECT field_key FROM expro_log_values WHERE expro_log_id=$1 AND field_value IS NOT NULL AND field_value!=''", log_id)
    filled_keys = {r["field_key"] for r in filled}
    missing = [r["field_label"] for r in required if r["field_key"] not in filled_keys]
    if missing:
        raise HTTPException(status_code=400, detail=f"Required fields missing: {', '.join(missing)}")
    await execute(conn,
        "UPDATE expro_logs SET status='SUBMITTED', submitted_by=$1, submitted_at=NOW() WHERE expro_log_id=$2",
        current_user.user_id, log_id)
    return {"message": "EXPRO log submitted"}

@router.patch("/logs/{log_id}/review")
async def review_log(log_id: int, body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","DIRECTOR"))):
    status = "APPROVED" if body.get("decision") == "APPROVE" else "REJECTED"
    await execute(conn,
        "UPDATE expro_logs SET status=$1, reviewed_by=$2, reviewed_at=NOW(), notes=COALESCE($3,notes) WHERE expro_log_id=$4",
        status, current_user.user_id, body.get("notes"), log_id)
    return {"message": f"EXPRO log {status.lower()}"}
