from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/comments", tags=["Comments"])

class CommentCreate(BaseModel):
    body: str
    is_internal: bool = True
    parent_id: Optional[int] = None

async def _own_bid_or_404(conn, bid_id: int, company_id: int):
    ok = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Bid not found")

@router.get("/bid/{bid_id}")
async def get_bid_comments(bid_id: int, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn, """
        SELECT c.*,u.full_name AS author_name,u.job_title AS author_title,
               COALESCE(
                 (SELECT COUNT(*) FROM comments r WHERE r.parent_id=c.comment_id AND r.is_deleted=FALSE),
                 0
               ) AS reply_count
        FROM comments c JOIN users u ON c.created_by=u.user_id
        WHERE c.bid_id=$1 AND c.is_deleted=FALSE AND c.parent_id IS NULL
        ORDER BY c.created_at DESC""", bid_id)

@router.get("/bid/{bid_id}/thread/{comment_id}")
async def get_thread(bid_id: int, comment_id: int, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn, """
        SELECT c.*,u.full_name AS author_name
        FROM comments c JOIN users u ON c.created_by=u.user_id
        WHERE c.bid_id=$1 AND c.parent_id=$2 AND c.is_deleted=FALSE
        ORDER BY c.created_at""", bid_id, comment_id)

@router.post("/bid/{bid_id}", status_code=201)
async def add_comment(bid_id: int, body: CommentCreate, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    await execute(conn,
        "INSERT INTO comments (bid_id,body,is_internal,parent_id,created_by,company_id) VALUES ($1,$2,$3,$4,$5,$6)",
        bid_id, body.body.strip(), body.is_internal, body.parent_id, current_user.user_id, company_id)
    return {"message": "Comment added"}

@router.delete("/{comment_id}")
async def delete_comment(comment_id: int, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    comment = await fetch_all(conn,
        "SELECT created_by FROM comments WHERE comment_id=$1 AND company_id=$2", comment_id, company_id)
    if not comment:
        raise HTTPException(status_code=404)
    if comment[0]["created_by"] != current_user.user_id and not current_user.has_role("ADMIN"):
        raise HTTPException(status_code=403, detail="Cannot delete others' comments")
    await execute(conn,
        "UPDATE comments SET is_deleted=TRUE WHERE comment_id=$1", comment_id)
    return {"message": "Comment deleted"}
