"""Module 2 — RFP ICT."""
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/rfp-ict", tags=["RFP ICT"])

BID_BOND_PCTS = (1, 2, 3)
MAX_SCOPE_LEVELS = 5

# The original ICT scope list (Level 1), given to every company the first time it opens Module 2.
DEFAULT_ICT_SCOPE = [
    ("Infrastructure", "البنية التحتية"),
    ("End User", "المستخدم النهائي"),
    ("Software", "البرمجيات"),
    ("Managed Services", "الخدمات المُدارة"),
    ("Others", "أخرى"),
]


class RfpIn(BaseModel):
    client_id: int
    submission_date: date
    queries_deadline: Optional[date] = None
    bid_bond_required: bool = False
    bid_bond_pct: Optional[float] = None
    scope_ids: List[int] = Field(default_factory=list)


class ScopeOptionIn(BaseModel):
    parent_id: Optional[int] = None
    cat_name: str = Field(..., min_length=1, max_length=100)
    cat_name_ar: Optional[str] = Field(None, max_length=100)


# ── Scope of work list ────────────────────────────────────────────────────────

async def _ensure_default_scope(conn, company_id: int):
    has_any = await fetch_val(conn,
        "SELECT 1 FROM service_categories WHERE company_id=$1 AND service_type='ICT' LIMIT 1", company_id)
    if has_any:
        return
    for i, (name, name_ar) in enumerate(DEFAULT_ICT_SCOPE, 1):
        await execute(conn, """
            INSERT INTO service_categories (company_id, service_type, cat_name, cat_name_ar, level, sort_order)
            VALUES ($1,'ICT',$2,$3,1,$4)""", company_id, name, name_ar, i)


@router.get("/scope-options")
async def list_scope_options(conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Flat list of the ICT scope tree (parent_id links the levels)."""
    company_id = require_company(current_user)
    await _ensure_default_scope(conn, company_id)
    return await fetch_all(conn, """
        SELECT cat_id, parent_id, level, cat_name, cat_name_ar, sort_order
        FROM service_categories
        WHERE company_id=$1 AND service_type='ICT' AND is_active=TRUE
        ORDER BY level, sort_order, lower(cat_name)""", company_id)


@router.post("/scope-options", status_code=201)
async def add_scope_option(body: ScopeOptionIn, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    name = body.cat_name.strip()
    level = 1
    if body.parent_id:
        parent = await fetch_one(conn, """
            SELECT level FROM service_categories
            WHERE cat_id=$1 AND company_id=$2 AND service_type='ICT' AND is_active=TRUE""", body.parent_id, company_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent item not found")
        if parent["level"] >= MAX_SCOPE_LEVELS:
            raise HTTPException(status_code=400, detail=f"The scope list goes down {MAX_SCOPE_LEVELS} levels at most")
        level = parent["level"] + 1
    duplicate = await fetch_val(conn, """
        SELECT 1 FROM service_categories
        WHERE company_id=$1 AND service_type='ICT' AND is_active=TRUE
          AND parent_id IS NOT DISTINCT FROM $2 AND lower(cat_name)=lower($3)""", company_id, body.parent_id, name)
    if duplicate:
        raise HTTPException(status_code=400, detail=f"\"{name}\" is already in this part of the list")
    sort_order = await fetch_val(conn, """
        SELECT COALESCE(MAX(sort_order),0)+1 FROM service_categories
        WHERE company_id=$1 AND service_type='ICT' AND parent_id IS NOT DISTINCT FROM $2""", company_id, body.parent_id)
    cat_id = await fetch_val(conn, """
        INSERT INTO service_categories (company_id, service_type, parent_id, cat_name, cat_name_ar, level, sort_order)
        VALUES ($1,'ICT',$2,$3,$4,$5,$6) RETURNING cat_id""",
        company_id, body.parent_id, name, (body.cat_name_ar or "").strip() or None, level, sort_order)
    return {"cat_id": cat_id, "level": level}


@router.delete("/scope-options/{cat_id}")
async def remove_scope_option(cat_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    """Removes an item and everything under it — unless an RFP uses any of them."""
    company_id = require_company(current_user)
    subtree = await fetch_all(conn, """
        WITH RECURSIVE t AS (
            SELECT cat_id FROM service_categories
            WHERE cat_id=$1 AND company_id=$2 AND service_type='ICT' AND is_active=TRUE
            UNION ALL
            SELECT c.cat_id FROM service_categories c JOIN t ON c.parent_id=t.cat_id
            WHERE c.is_active=TRUE
        ) SELECT cat_id FROM t""", cat_id, company_id)
    if not subtree:
        raise HTTPException(status_code=404, detail="Item not found")
    ids = [r["cat_id"] for r in subtree]
    used = await fetch_val(conn, "SELECT COUNT(DISTINCT rfp_id) FROM rfp_ict_scope WHERE cat_id = ANY($1::int[])", ids)
    if used:
        raise HTTPException(status_code=400,
            detail=f"Used in {used} RFP{'s' if used != 1 else ''}, so it can't be removed")
    await execute(conn, "UPDATE service_categories SET is_active=FALSE WHERE cat_id = ANY($1::int[])", ids)
    return {"message": "Removed", "removed": len(ids)}


# ── RFPs ──────────────────────────────────────────────────────────────────────

async def _validated(conn, company_id: int, body: RfpIn) -> dict:
    client_ok = await fetch_val(conn,
        "SELECT 1 FROM clients WHERE client_id=$1 AND company_id=$2 AND is_active=TRUE", body.client_id, company_id)
    if not client_ok:
        raise HTTPException(status_code=400, detail="Pick a client from the list")
    if body.queries_deadline and body.queries_deadline > body.submission_date:
        raise HTTPException(status_code=400, detail="The last date for queries must be on or before the submission date")

    pct = None
    if body.bid_bond_required:
        if body.bid_bond_pct not in BID_BOND_PCTS:
            raise HTTPException(status_code=400,
                detail=f"Choose a bid bond percentage: {', '.join(f'{p}%' for p in BID_BOND_PCTS)}")
        pct = body.bid_bond_pct

    scope_ids = sorted(set(body.scope_ids))
    if scope_ids:
        rows = await fetch_all(conn, """
            SELECT cat_id, parent_id, level FROM service_categories
            WHERE cat_id = ANY($1::int[]) AND company_id=$2 AND service_type='ICT' AND is_active=TRUE""",
            scope_ids, company_id)
        if len(rows) != len(scope_ids):
            raise HTTPException(status_code=400, detail="Some scope items no longer exist — reload and choose again")
        if sum(1 for r in rows if r["parent_id"] is None) > 1:
            raise HTTPException(status_code=400, detail="Choose only one Level 1 scope")
        chosen = set(scope_ids)
        if any(r["parent_id"] is not None and r["parent_id"] not in chosen for r in rows):
            raise HTTPException(status_code=400, detail="Each scope item must sit under an item chosen at the level above")

    return {"pct": pct, "scope_ids": scope_ids}


async def _save_scope(conn, rfp_id: int, scope_ids: List[int]):
    await execute(conn, "DELETE FROM rfp_ict_scope WHERE rfp_id=$1", rfp_id)
    for cid in scope_ids:
        await execute(conn, "INSERT INTO rfp_ict_scope (rfp_id, cat_id) VALUES ($1,$2)", rfp_id, cid)


async def _get_rfp(conn, rfp_id: int, company_id: int) -> dict:
    rfp = await fetch_one(conn, """
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar,
               c.billing_address_en, c.billing_address_ar
        FROM rfp_ict r JOIN clients c ON r.client_id=c.client_id
        WHERE r.rfp_id=$1 AND r.company_id=$2""", rfp_id, company_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="RFP not found")
    rfp["scope"] = await fetch_all(conn, """
        SELECT sc.cat_id, sc.parent_id, sc.level, sc.cat_name, sc.cat_name_ar
        FROM rfp_ict_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
        WHERE s.rfp_id=$1 ORDER BY sc.level, sc.sort_order, sc.cat_name""", rfp_id)
    return rfp


@router.get("")
async def list_rfps(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar,
               (r.submission_date - CURRENT_DATE)::INT AS days_to_submission,
               (SELECT sc.cat_name FROM rfp_ict_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
                WHERE s.rfp_id=r.rfp_id AND sc.parent_id IS NULL LIMIT 1) AS scope_level1,
               (SELECT COUNT(*) FROM rfp_ict_scope s WHERE s.rfp_id=r.rfp_id)::INT AS scope_count
        FROM rfp_ict r JOIN clients c ON r.client_id=c.client_id
        WHERE r.company_id=$1
        ORDER BY r.created_at DESC""", company_id)


@router.get("/{rfp_id}")
async def get_rfp(rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _get_rfp(conn, rfp_id, require_company(current_user))


@router.post("", status_code=201)
async def create_rfp(body: RfpIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    v = await _validated(conn, company_id, body)
    async with conn.transaction():
        n = await fetch_val(conn, "SELECT nextval('rfp_ict_number_seq')")
        rfp_number = f"RFP-ICT-{datetime.now().year}-{str(n).zfill(5)}"
        rfp_id = await fetch_val(conn, """
            INSERT INTO rfp_ict (company_id, rfp_number, client_id, submission_date, queries_deadline,
                                 bid_bond_required, bid_bond_pct, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING rfp_id""",
            company_id, rfp_number, body.client_id, body.submission_date, body.queries_deadline,
            body.bid_bond_required, v["pct"], current_user.user_id)
        await _save_scope(conn, rfp_id, v["scope_ids"])
    return await _get_rfp(conn, rfp_id, company_id)


@router.put("/{rfp_id}")
async def update_rfp(rfp_id: int, body: RfpIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    exists = await fetch_val(conn, "SELECT 1 FROM rfp_ict WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if not exists:
        raise HTTPException(status_code=404, detail="RFP not found")
    v = await _validated(conn, company_id, body)
    async with conn.transaction():
        await execute(conn, """
            UPDATE rfp_ict SET client_id=$1, submission_date=$2, queries_deadline=$3,
                   bid_bond_required=$4, bid_bond_pct=$5, updated_at=NOW()
            WHERE rfp_id=$6 AND company_id=$7""",
            body.client_id, body.submission_date, body.queries_deadline,
            body.bid_bond_required, v["pct"], rfp_id, company_id)
        await _save_scope(conn, rfp_id, v["scope_ids"])
    return await _get_rfp(conn, rfp_id, company_id)


@router.delete("/{rfp_id}")
async def delete_rfp(rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    result = await execute(conn, "DELETE FROM rfp_ict WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="RFP not found")
    return {"message": "Deleted"}
