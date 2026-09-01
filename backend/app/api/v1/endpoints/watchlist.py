from fastapi import APIRouter, Depends, HTTPException
from app.db.postgres import get_db, fetch_all, execute, fetch_one, fetch_val, require_company
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/watchlist", tags=["Watchlist"])

@router.get("")
async def get_watchlist(conn=Depends(get_db), current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn,
        """SELECT b.bid_id,b.bid_number,b.bid_title,b.budget,b.submission_deadline,
                  bs.status_name,bs.color_hex,bt.type_code AS bid_type_code,
                  w.added_at,
                  CASE WHEN b.submission_deadline > NOW()+INTERVAL '7 days' THEN 'GREEN'
                       WHEN b.submission_deadline > NOW()+INTERVAL '2 days' THEN 'ORANGE'
                       WHEN b.submission_deadline > NOW() THEN 'RED' ELSE 'GRAY' END AS deadline_color
           FROM user_watchlist w JOIN bids b ON w.bid_id=b.bid_id
           JOIN bid_statuses bs ON b.status_id=bs.status_id
           JOIN bid_types bt ON b.bid_type_id=bt.type_id
           WHERE w.user_id=$1 AND b.is_deleted=FALSE AND b.company_id=$2 ORDER BY w.added_at DESC""",
        current_user.user_id, company_id)

@router.post("/{bid_id}")
async def add_to_watchlist(bid_id: int, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    company_id = require_company(current_user)
    bid_ok = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not bid_ok: raise HTTPException(status_code=404, detail="Bid not found")
    existing = await fetch_one(conn,
        "SELECT 1 FROM user_watchlist WHERE user_id=$1 AND bid_id=$2",
        current_user.user_id, bid_id)
    if existing: raise HTTPException(status_code=409, detail="Already in watchlist")
    await execute(conn,
        "INSERT INTO user_watchlist (user_id,bid_id) VALUES ($1,$2)",
        current_user.user_id, bid_id)
    return {"message": "Added to watchlist"}

@router.delete("/{bid_id}")
async def remove_from_watchlist(bid_id: int, conn=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)):
    await execute(conn,
        "DELETE FROM user_watchlist WHERE user_id=$1 AND bid_id=$2",
        current_user.user_id, bid_id)
    return {"message": "Removed from watchlist"}
