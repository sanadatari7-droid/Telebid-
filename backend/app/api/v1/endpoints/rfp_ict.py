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


# Drop-down lists from the bid log (File 2, Sheet 2). Seeded once per company into
# dropdown_configs, where admins can edit them (System Settings → Dropdowns).
RFP_LISTS = {
    "rfp_channel": ("RFP channel", [
        ("GOV_ETIMAD", "Government – Etimad", "حكومي – اعتماد"),
        ("CORP_ETIMAD", "Corporate – Etimad", "شركات – اعتماد"),
        ("GOV_EMAIL", "Government – Email invitation", "حكومي – دعوة بالبريد"),
        ("CORP_EMAIL", "Corporate – Email invitation", "شركات – دعوة بالبريد"),
        ("GOV_FORSAH", "Government – Forsah", "حكومي – فرصة"),
        ("CORP_FORSAH", "Corporate – Forsah", "شركات – فرصة"),
        ("WHOLESALES", "Wholesales", "مبيعات الجملة"),
    ]),
    "rfp_project_type": ("RFP project type", [
        ("DIRECT", "Direct", "مباشر"),
        ("RFP", "RFP", "طلب عروض"),
        ("RFI", "RFI", "طلب معلومات"),
        ("RFQ", "RFQ", "طلب تسعير"),
        ("INVITATION", "Invitation", "دعوة"),
        ("FRAMEWORK", "Framework agreement", "اتفاقية إطارية"),
    ]),
    "rfp_phase": ("RFP phase", [
        ("ON_GOING", "On going", "جارٍ"),
        ("WIP", "Work in progress", "قيد العمل"),
        ("SUBMITTED", "Submitted", "تم التقديم"),
        ("DROPPED", "Dropped", "تم الاستبعاد"),
    ]),
    "rfp_status": ("RFP status", [
        ("PENDING", "Pending", "قيد الانتظار"),
        ("IN_PROGRESS", "In progress", "قيد التنفيذ"),
        ("NEGOTIATION", "Negotiation", "تفاوض"),
        ("WON", "Won", "فوز"),
        ("LOST", "Lost", "خسارة"),
        ("LOST_TECHNICAL", "Lost – technical", "خسارة فنية"),
        ("LOST_FINANCIAL", "Lost – financial", "خسارة مالية"),
        ("CANCELLED", "Cancelled", "ملغى"),
        ("DROPPED", "Dropped", "تم الاستبعاد"),
    ]),
    "rfp_reason": ("RFP drop reason", [
        ("NO_QUOTES", "No quotes", "لا توجد عروض أسعار"),
        ("SHORT_TIME", "Time is too short", "الوقت قصير جداً"),
        ("NON_STANDARD", "Not standard products", "منتجات غير قياسية"),
        ("UNCLEAR_SCOPE", "Scope is not clear", "النطاق غير واضح"),
        ("OUT_OF_SCOPE", "Out of our scope", "خارج نطاق عملنا"),
        ("NO_PARTNERSHIP", "No partnership", "لا توجد شراكة"),
        ("OTHER_PROVIDER", "Renewal for another provider", "تجديد لمزود آخر"),
        ("CLIENT_CANCELLED", "Cancelled by the client", "ألغاه العميل"),
    ]),
    "rfp_project_size": ("RFP project size", [
        ("SMALL", "Small", "صغير"),
        ("MEDIUM", "Medium", "متوسط"),
        ("LARGE", "Large", "كبير"),
    ]),
}
# Which form field each list backs.
FIELD_LISTS = {"channel": "rfp_channel", "project_type": "rfp_project_type", "phase": "rfp_phase",
               "status": "rfp_status", "reason": "rfp_reason", "project_size": "rfp_project_size"}
LOST_STATUSES = {"LOST", "LOST_TECHNICAL", "LOST_FINANCIAL"}


class RfpIn(BaseModel):
    client_id: int
    rfp_ref: Optional[str] = Field(None, max_length=100)
    channel: Optional[str] = None
    project_type: Optional[str] = None
    description: Optional[str] = Field(None, max_length=5000)
    submission_date: date
    queries_deadline: Optional[date] = None
    bid_bond_required: bool = False
    bid_bond_pct: Optional[float] = None
    scope_ids: List[int] = Field(default_factory=list)
    am_id: Optional[int] = None
    presales_emp_id: Optional[int] = None
    bm_id: Optional[int] = None
    project_size: Optional[str] = None
    tcv: Optional[float] = Field(None, ge=0)
    phase: Optional[str] = None
    status: Optional[str] = None
    reason: Optional[str] = None
    winner_name: Optional[str] = Field(None, max_length=200)
    winner_tcv: Optional[float] = Field(None, ge=0)


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


# ── Lists and team ────────────────────────────────────────────────────────────

async def _ensure_lists(conn, company_id: int):
    for key, (label, options) in RFP_LISTS.items():
        if await fetch_val(conn, "SELECT 1 FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2 LIMIT 1",
                           company_id, key):
            continue
        for i, (value, opt_label, opt_label_ar) in enumerate(options, 1):
            await execute(conn, """
                INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, option_label_ar, sort_order)
                VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING""",
                company_id, key, label, value, opt_label, opt_label_ar, i)


@router.get("/lists")
async def get_lists(conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Drop-down options for the RFP form, plus the company's currency (Module 1 / Sub-module A)."""
    company_id = require_company(current_user)
    await _ensure_lists(conn, company_id)
    rows = await fetch_all(conn, """
        SELECT dropdown_key, option_value AS value, option_label AS label, option_label_ar AS label_ar
        FROM dropdown_configs WHERE company_id=$1 AND dropdown_key = ANY($2::text[]) AND is_active=TRUE
        ORDER BY dropdown_key, sort_order""", company_id, list(RFP_LISTS))
    lists = {field: [] for field in FIELD_LISTS}
    key_to_field = {v: k for k, v in FIELD_LISTS.items()}
    for r in rows:
        lists[key_to_field[r.pop("dropdown_key")]].append(r)
    currency = await fetch_one(conn, """
        SELECT cur.currency_code AS code, cur.symbol, COALESCE(co.currency_decimals, 2) AS decimals
        FROM companies co LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        WHERE co.company_id=$1""", company_id)
    return {"lists": lists, "currency": currency, "bid_bond_pcts": list(BID_BOND_PCTS)}


@router.get("/team-options")
async def team_options(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return {
        "account_managers": await fetch_all(conn, """
            SELECT am_id AS id, full_name AS name, initials FROM company_account_managers
            WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name""", company_id),
        "bid_managers": await fetch_all(conn, """
            SELECT bm_id AS id, full_name AS name, initials FROM company_bid_managers
            WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name""", company_id),
        "presales": await fetch_all(conn, """
            SELECT emp_id AS id, full_name AS name, job_title FROM employees
            WHERE company_id=$1 AND is_active=TRUE AND employee_type='PRESALES' ORDER BY full_name""", company_id),
    }


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

    await _ensure_lists(conn, company_id)
    choices = {}
    for field, key in FIELD_LISTS.items():
        value = getattr(body, field)
        if value:
            ok = await fetch_val(conn, """
                SELECT 1 FROM dropdown_configs
                WHERE company_id=$1 AND dropdown_key=$2 AND option_value=$3 AND is_active=TRUE""", company_id, key, value)
            if not ok:
                raise HTTPException(status_code=400, detail=f"\"{value}\" isn't one of the {RFP_LISTS[key][0].lower()} options")
        choices[field] = value or None
    choices["phase"] = choices["phase"] or "ON_GOING"
    choices["status"] = choices["status"] or "PENDING"
    # Keep the record coherent: a drop reason only for dropped/cancelled, the winner only when lost.
    if not (choices["phase"] == "DROPPED" or choices["status"] in ("DROPPED", "CANCELLED")):
        choices["reason"] = None
    lost = choices["status"] in LOST_STATUSES
    choices["winner_name"] = (body.winner_name or "").strip() or None if lost else None
    choices["winner_tcv"] = body.winner_tcv if lost else None

    for field, table, id_col, extra in (
        ("am_id", "company_account_managers", "am_id", ""),
        ("bm_id", "company_bid_managers", "bm_id", ""),
        ("presales_emp_id", "employees", "emp_id", " AND employee_type='PRESALES'"),
    ):
        value = getattr(body, field)
        if value and not await fetch_val(conn,
                f"SELECT 1 FROM {table} WHERE {id_col}=$1 AND company_id=$2 AND is_active=TRUE{extra}", value, company_id):
            raise HTTPException(status_code=400, detail="Pick the team members from the lists")

    return {"pct": pct, "scope_ids": scope_ids, **choices}


async def _write_fields(conn, rfp_id: int, company_id: int, body: RfpIn, v: dict):
    await execute(conn, """
        UPDATE rfp_ict SET client_id=$1, rfp_ref=$2, channel=$3, project_type=$4, description=$5,
               submission_date=$6, queries_deadline=$7, bid_bond_required=$8, bid_bond_pct=$9,
               am_id=$10, presales_emp_id=$11, bm_id=$12, project_size=$13, tcv=$14,
               phase=$15, status=$16, reason=$17, winner_name=$18, winner_tcv=$19, updated_at=NOW()
        WHERE rfp_id=$20 AND company_id=$21""",
        body.client_id, (body.rfp_ref or "").strip() or None, v["channel"], v["project_type"],
        (body.description or "").strip() or None, body.submission_date, body.queries_deadline,
        body.bid_bond_required, v["pct"], body.am_id, body.presales_emp_id, body.bm_id,
        v["project_size"], body.tcv, v["phase"], v["status"], v["reason"], v["winner_name"], v["winner_tcv"],
        rfp_id, company_id)
    await _save_scope(conn, rfp_id, v["scope_ids"])


async def _save_scope(conn, rfp_id: int, scope_ids: List[int]):
    await execute(conn, "DELETE FROM rfp_ict_scope WHERE rfp_id=$1", rfp_id)
    for cid in scope_ids:
        await execute(conn, "INSERT INTO rfp_ict_scope (rfp_id, cat_id) VALUES ($1,$2)", rfp_id, cid)


async def _get_rfp(conn, rfp_id: int, company_id: int) -> dict:
    rfp = await fetch_one(conn, """
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar,
               c.billing_address_en, c.billing_address_ar, c.is_strategic,
               am.full_name AS am_name, bm.full_name AS bm_name, e.full_name AS presales_name
        FROM rfp_ict r JOIN clients c ON r.client_id=c.client_id
        LEFT JOIN company_account_managers am ON am.am_id=r.am_id
        LEFT JOIN company_bid_managers bm ON bm.bm_id=r.bm_id
        LEFT JOIN employees e ON e.emp_id=r.presales_emp_id
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
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar, c.is_strategic,
               am.full_name AS am_name,
               (r.submission_date - CURRENT_DATE)::INT AS days_to_submission,
               (SELECT sc.cat_name FROM rfp_ict_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
                WHERE s.rfp_id=r.rfp_id AND sc.parent_id IS NULL LIMIT 1) AS scope_level1,
               (SELECT COUNT(*) FROM rfp_ict_scope s WHERE s.rfp_id=r.rfp_id)::INT AS scope_count
        FROM rfp_ict r JOIN clients c ON r.client_id=c.client_id
        LEFT JOIN company_account_managers am ON am.am_id=r.am_id
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
            INSERT INTO rfp_ict (company_id, rfp_number, created_by, client_id, submission_date) VALUES ($1,$2,$3,$4,$5)
            RETURNING rfp_id""", company_id, rfp_number, current_user.user_id, body.client_id, body.submission_date)
        await _write_fields(conn, rfp_id, company_id, body, v)
    return await _get_rfp(conn, rfp_id, company_id)


@router.put("/{rfp_id}")
async def update_rfp(rfp_id: int, body: RfpIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    exists = await fetch_val(conn, "SELECT 1 FROM rfp_ict WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if not exists:
        raise HTTPException(status_code=404, detail="RFP not found")
    v = await _validated(conn, company_id, body)
    async with conn.transaction():
        await _write_fields(conn, rfp_id, company_id, body, v)
    return await _get_rfp(conn, rfp_id, company_id)


@router.delete("/{rfp_id}")
async def delete_rfp(rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    result = await execute(conn, "DELETE FROM rfp_ict WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="RFP not found")
    return {"message": "Deleted"}
