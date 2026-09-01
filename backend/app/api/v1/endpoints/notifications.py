from fastapi import APIRouter, Depends, Query
from app.db.postgres import get_db, fetch_page, fetch_one, execute, fetch_val
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/notifications", tags=["Notifications"])

@router.get("")
async def get_notifications(page:int=Query(1,ge=1), page_size:int=Query(20),
                            unread_only:bool=False, conn=Depends(get_db),
                            current_user:CurrentUser=Depends(get_current_user)):
    args = [current_user.user_id]
    sql = "SELECT * FROM notifications WHERE user_id=$1"
    if unread_only: sql += " AND is_read=FALSE"
    sql += " ORDER BY created_at DESC"
    return await fetch_page(conn, sql, args, page, page_size)

@router.get("/unread-count")
async def unread_count(conn=Depends(get_db), current_user:CurrentUser=Depends(get_current_user)):
    count = await fetch_val(conn, "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE", current_user.user_id)
    return {"unread_count": count or 0}

@router.patch("/{notif_id}/read")
async def mark_read(notif_id:int, conn=Depends(get_db), current_user:CurrentUser=Depends(get_current_user)):
    await execute(conn, "UPDATE notifications SET is_read=TRUE WHERE notif_id=$1 AND user_id=$2", notif_id, current_user.user_id)
    return {"message": "Marked as read"}

@router.patch("/mark-all-read")
async def mark_all_read(conn=Depends(get_db), current_user:CurrentUser=Depends(get_current_user)):
    await execute(conn, "UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE", current_user.user_id)
    return {"message": "All notifications marked as read"}
