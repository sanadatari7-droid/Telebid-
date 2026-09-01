from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_page, require_company
from app.middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/bid-logs", tags=["Bid Logs"])

@router.get("")
async def get_bid_logs(
    page: int=Query(1,ge=1), page_size: int=Query(50),
    bid_id: Optional[int]=None, module: Optional[str]=None,
    user_id: Optional[int]=None, action: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conditions = ["bl.company_id=$1"]
    args = [company_id]
    if bid_id:
        args.append(bid_id); conditions.append(f"bl.bid_id=${len(args)}")
    if module:
        args.append(module); conditions.append(f"bl.module=${len(args)}")
    if user_id:
        args.append(user_id); conditions.append(f"bl.performed_by=${len(args)}")
    if action:
        args.append(f"%{action}%"); conditions.append(f"bl.action ILIKE ${len(args)}")
    where = " AND ".join(conditions)
    sql = f"""SELECT bl.*, b.bid_number, b.bid_title, u.full_name AS performed_by_name, u.username
              FROM bid_logs bl
              LEFT JOIN bids b ON bl.bid_id=b.bid_id
              LEFT JOIN users u ON bl.performed_by=u.user_id
              WHERE {where} ORDER BY bl.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.get("/evaluation-logs")
async def get_eval_logs(page: int=Query(1,ge=1), page_size: int=Query(50),
    bid_id: Optional[int]=None, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    args = [company_id]
    where = "b.company_id=$1"
    if bid_id:
        args.append(bid_id); where += f" AND el.bid_id=${len(args)}"
    sql = f"""SELECT el.*, b.bid_number, u.full_name AS performed_by_name
              FROM evaluation_logs el
              JOIN bids b ON el.bid_id=b.bid_id
              LEFT JOIN users u ON el.performed_by=u.user_id
              WHERE {where} ORDER BY el.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.get("/user-activity")
async def user_activity(page: int=Query(1,ge=1), page_size: int=Query(50),
    conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    sql = """SELECT al.*, u.full_name AS user_name, u.username, u.email
             FROM audit_logs al LEFT JOIN users u ON al.user_id=u.user_id
             WHERE al.company_id=$1
             ORDER BY al.action_at DESC"""
    return await fetch_page(conn, sql, [company_id], page, page_size)

@router.get("/summary")
async def logs_summary(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT module, action, COUNT(*) AS count
        FROM bid_logs
        WHERE company_id=$1
        GROUP BY module, action
        ORDER BY count DESC LIMIT 20""", company_id)
