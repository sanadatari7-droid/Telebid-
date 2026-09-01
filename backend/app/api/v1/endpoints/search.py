from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.db.postgres import get_db, fetch_all
from app.middleware.auth import get_current_user

router = APIRouter(prefix="/search", tags=["Global Search"])

@router.get("")
async def global_search(q: str = Query(..., min_length=2), conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    """Search across bids, vendors, references, contracts, opportunities."""
    term = f"%{q}%"
    results = []

    # Search bids
    bids = await fetch_all(conn, """
        SELECT b.bid_id AS id, b.bid_number, b.bid_title AS title,
               bs.status_name AS status, 'bid' AS entity_type,
               b.customer_name, b.created_at
        FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id
        WHERE b.is_deleted=FALSE AND (
            b.bid_title ILIKE $1 OR b.bid_number ILIKE $1 OR
            b.customer_name ILIKE $1 OR b.organization ILIKE $1 OR
            b.description ILIKE $1
        ) LIMIT 5""", term)
    results.extend([{**r, "url": f"/bids/{r['id']}", "subtitle": f"{r['bid_number']} · {r.get('customer_name','')}"} for r in bids])

    # Search vendors
    vendors = await fetch_all(conn, """
        SELECT v.vendor_id AS id, v.company_name AS title, 'vendor' AS entity_type,
               v.business_category AS status, v.email, v.created_at
        FROM vendors v WHERE v.is_deleted=FALSE AND (
            v.company_name ILIKE $1 OR v.email ILIKE $1 OR
            v.contact_person ILIKE $1 OR v.registration_no ILIKE $1
        ) LIMIT 5""", term)
    results.extend([{**r, "url": f"/vendors", "subtitle": r.get("status","") or "Vendor"} for r in vendors])

    # Search opportunities
    opps = await fetch_all(conn, """
        SELECT o.opp_id AS id, o.opp_number AS bid_number, o.title AS title,
               o.status, 'opportunity' AS entity_type, o.customer_name, o.created_at
        FROM opportunities o WHERE o.is_deleted=FALSE AND (
            o.title ILIKE $1 OR o.opp_number ILIKE $1 OR o.customer_name ILIKE $1
        ) LIMIT 3""", term)
    results.extend([{**r, "url": f"/opportunities", "subtitle": f"{r['bid_number']} · {r.get('customer_name','')}"} for r in opps])

    # Search contracts
    contracts = await fetch_all(conn, """
        SELECT c.contract_id AS id, c.contract_number AS bid_number,
               b.bid_title AS title, c.status, 'contract' AS entity_type,
               v.company_name AS customer_name, c.created_at
        FROM contracts c JOIN bids b ON c.bid_id=b.bid_id
        JOIN vendors v ON c.vendor_id=v.vendor_id
        WHERE c.is_deleted=FALSE AND (
            c.contract_number ILIKE $1 OR b.bid_title ILIKE $1 OR v.company_name ILIKE $1
        ) LIMIT 3""", term)
    results.extend([{**r, "url": f"/contracts", "subtitle": f"{r['bid_number']} · {r.get('customer_name','')}"} for r in contracts])

    # Sort by created_at
    results.sort(key=lambda x: str(x.get("created_at","") or ""), reverse=True)
    return {"query": q, "count": len(results), "results": results[:15]}

@router.get("/bids")
async def search_bids(
    q: Optional[str]=None, module: Optional[str]=None,
    is_government: Optional[bool]=None, status: Optional[str]=None,
    date_from: Optional[str]=None, date_to: Optional[str]=None,
    budget_min: Optional[float]=None, budget_max: Optional[float]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Advanced bid search with all filters."""
    conditions = ["b.is_deleted=FALSE"]
    args = []
    if q:
        args.append(f"%{q}%")
        conditions.append(f"(b.bid_title ILIKE ${len(args)} OR b.bid_number ILIKE ${len(args)} OR b.customer_name ILIKE ${len(args)})")
    if module:
        args.append(module); conditions.append(f"bm.module_code=${len(args)}")
    if is_government is not None:
        args.append(is_government); conditions.append(f"b.is_government=${len(args)}")
    if status:
        args.append(status); conditions.append(f"bs.status_code=${len(args)}")
    if date_from:
        args.append(date_from); conditions.append(f"b.created_at >= ${len(args)}::date")
    if date_to:
        args.append(date_to); conditions.append(f"b.created_at <= ${len(args)}::date + INTERVAL '1 day'")
    if budget_min:
        args.append(budget_min); conditions.append(f"COALESCE(b.budget, b.estimated_value, 0) >= ${len(args)}")
    if budget_max:
        args.append(budget_max); conditions.append(f"COALESCE(b.budget, b.estimated_value, 0) <= ${len(args)}")
    where = " AND ".join(conditions)
    return await fetch_all(conn, f"""
        SELECT b.bid_id, b.bid_number, b.bid_title, b.customer_name, b.organization,
               b.is_government, b.budget, b.estimated_value, b.submission_deadline,
               b.location_city, b.location_country, b.created_at,
               bs.status_code, bs.status_name, bs.color_hex,
               bm.module_code, bm.module_name, c.symbol
        FROM bids b
        JOIN bid_statuses bs ON b.status_id=bs.status_id
        LEFT JOIN bid_modules bm ON b.module_id=bm.module_id
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        WHERE {where} ORDER BY b.created_at DESC LIMIT 100""", *args)
