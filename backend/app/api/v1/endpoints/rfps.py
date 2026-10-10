"""Modules 2–4 — RFP ICT, RFP Telecom and EXPRO.

The three modules work the same way (details → Go / No-Go evaluation → bid bond) and share
these tables; each RFP belongs to one module. What differs is set in MODULES: the numbering,
the scope-of-work list, the drop-down lists and which fields the module uses.

- RFP ICT: the bid log fields (File 2) and the five-level ICT scope of work.
- RFP Telecom: the same, with a Family → Solution scope and the old app's technical fields.
- EXPRO: government requests from the EXPRO portal, built from the EXPRO log (File 1). They
  carry the EXPRO number instead of a channel, project type or scope list.
"""
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Dict, FrozenSet, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/rfps", tags=["RFPs (Modules 2–4)"])


class Module(str, Enum):
    ict = "ict"
    telecom = "telecom"
    expro = "expro"


BID_BOND_PCTS = (1, 2, 3)
LOST_STATUSES = {"LOST", "LOST_TECHNICAL", "LOST_FINANCIAL"}

# Default scope lists, given to a company the first time it opens the module.
# Each entry: (name, Arabic name, items under it).
DEFAULT_SCOPES = {
    # The original ICT scope list (Level 1).
    "ICT": [
        ("Infrastructure", "البنية التحتية", []),
        ("End User", "المستخدم النهائي", []),
        ("Software", "البرمجيات", []),
        ("Managed Services", "الخدمات المُدارة", []),
        ("Others", "أخرى", []),
    ],
    # Families and solutions from the bid log (File 2), grouped as in the old app.
    "TELECOM": [
        ("Connectivity", "الاتصال والربط", [
            "BDI", "BDI with MRS", "EBDI", "EBDI with MRS", "L2", "L2 with MRS", "L3 (IPVPN)", "L3 with MRS",
            "Internet & Connectivity", "Internet & Connectivity with MRS", "SIP Trunk", "SIP Trunk with MRS",
            "DWDM", "GMPLS", "VSAT",
        ]),
        ("Mobility", "الاتصالات المتنقلة", ["EBDI"]),
        ("Cyber Security", "الأمن السيبراني", ["L2"]),
    ],
}

# Drop-down lists, seeded once per company into dropdown_configs, where admins can edit
# them (System Settings → Dropdowns).
LISTS = {
    # Bid log (File 2, Sheet 2) — RFP ICT and RFP Telecom.
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
    # EXPRO log (File 1) — media and SLA are used by RFP Telecom too.
    "telecom_media": ("Telecom media", [
        ("FIBER", "Fiber", "ألياف ضوئية"),
        ("MW", "MW", "مايكروويف"),
        ("5G", "5G", "الجيل الخامس"),
        ("VSAT", "VSAT", "فيسات"),
    ]),
    "telecom_sla": ("Telecom SLA", [
        ("STANDARD", "Standard", "قياسي"),
        ("PREMIUM", "Premium", "مميز"),
    ]),
    "expro_phase": ("EXPRO phase", [
        ("ON_GOING", "On going", "جارٍ"),
        ("SUBMITTED", "Submitted", "تم التقديم"),
        ("DROPPED", "Dropped", "تم الاستبعاد"),
    ]),
    "expro_status": ("EXPRO status", [
        ("PENDING", "Pending", "قيد الانتظار"),
        ("WON", "Won", "فوز"),
        ("LOST", "Lost", "خسارة"),
        ("DROPPED", "Dropped", "تم الاستبعاد"),
    ]),
    "expro_reason": ("EXPRO drop reason", [
        ("CLIENT_CANCELLED", "Cancelled by the client", "ألغاه العميل"),
        ("NO_COVERAGE", "No coverage", "لا توجد تغطية"),
        ("WRONG_REQUEST", "Wrong request", "طلب خاطئ"),
        ("CLIENT_REQUESTED", "Requested by the client", "بطلب من العميل"),
        ("AM_REQUESTED", "Requested by AM", "بطلب من مدير الحساب"),
        ("OUT_OF_SCOPE", "Out of scope", "خارج النطاق"),
        ("RELATED_REQUEST", "Related to another request", "مرتبط بطلب آخر"),
        ("PORTAL_ISSUE", "Portal issue", "مشكلة في البوابة"),
    ]),
}

BID_LOG_LISTS = {"channel": "rfp_channel", "project_type": "rfp_project_type", "phase": "rfp_phase",
                 "status": "rfp_status", "reason": "rfp_reason", "project_size": "rfp_project_size"}
TELECOM_LISTS = {"media": "telecom_media", "sla": "telecom_sla"}

# Optional fields by source. Every module also has the client, reference, description,
# submission date, bid bond, team and phase / status / reason.
BID_LOG_FIELDS = frozenset({"rfp_title", "channel", "project_type", "queries_deadline", "project_size",
                            "tcv", "winner_name", "winner_tcv"})
TELECOM_FIELDS = frozenset({"sow", "media", "sla", "bandwidth_mbps", "quantity", "contract_duration",
                            "coverage_study", "location", "attachment_url", "nrc", "mrc",
                            "presales_comment", "am_comment", "bid_comment"})


@dataclass(frozen=True)
class ModuleSpec:
    code: str                   # rfps.module
    noun: str                   # what one record is called in messages
    number_prefix: str
    number_seq: str
    scope_type: Optional[str]   # service_categories.service_type of its scope list (None: no list)
    scope_levels: int
    lists: Dict[str, str]       # form field -> dropdown_configs key
    fields: FrozenSet[str]      # optional fields the module uses; the others are kept empty
    ref_required: bool = False  # EXPRO: the EXPRO number


MODULES = {
    Module.ict: ModuleSpec("ICT", "bid", "BID-ICT", "rfp_ict_number_seq", "ICT", 5,
                           BID_LOG_LISTS, BID_LOG_FIELDS),
    Module.telecom: ModuleSpec("TELECOM", "bid", "BID-TEL", "rfp_telecom_number_seq", "TELECOM", 2,
                               {**BID_LOG_LISTS, **TELECOM_LISTS}, BID_LOG_FIELDS | TELECOM_FIELDS),
    Module.expro: ModuleSpec("EXPRO", "request", "EXPRO", "rfp_expro_number_seq", None, 0,
                             {**TELECOM_LISTS, "phase": "expro_phase", "status": "expro_status", "reason": "expro_reason"},
                             TELECOM_FIELDS | {"request_date"}, ref_required=True),
}

# Columns written from the form, in a fixed order.
COLUMNS = (
    "client_id", "rfp_title", "rfp_ref", "channel", "project_type", "description",
    "submission_date", "queries_deadline", "request_date", "bid_bond_required", "bid_bond_pct",
    "sow", "media", "sla", "bandwidth_mbps", "quantity", "contract_duration", "coverage_study",
    "location", "attachment_url", "am_id", "presales_emp_id", "bm_id",
    "presales_comment", "am_comment", "bid_comment",
    "project_size", "tcv", "nrc", "mrc", "phase", "status", "reason", "winner_name", "winner_tcv",
)


class RfpIn(BaseModel):
    client_id: int
    submission_date: date
    rfp_title: Optional[str] = Field(None, max_length=300)
    rfp_ref: Optional[str] = Field(None, max_length=100)
    channel: Optional[str] = None
    project_type: Optional[str] = None
    description: Optional[str] = Field(None, max_length=5000)
    queries_deadline: Optional[date] = None
    request_date: Optional[date] = None
    bid_bond_required: bool = False
    bid_bond_pct: Optional[float] = None
    scope_ids: List[int] = Field(default_factory=list)
    sow: Optional[str] = Field(None, max_length=2000)
    media: Optional[str] = None
    sla: Optional[str] = None
    bandwidth_mbps: Optional[float] = Field(None, ge=0)
    quantity: Optional[int] = Field(None, ge=1)
    contract_duration: Optional[str] = Field(None, max_length=50)
    coverage_study: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=1000)
    attachment_url: Optional[str] = Field(None, max_length=1000)
    am_id: Optional[int] = None
    presales_emp_id: Optional[int] = None
    bm_id: Optional[int] = None
    presales_comment: Optional[str] = Field(None, max_length=2000)
    am_comment: Optional[str] = Field(None, max_length=2000)
    bid_comment: Optional[str] = Field(None, max_length=2000)
    project_size: Optional[str] = None
    tcv: Optional[float] = Field(None, ge=0)
    nrc: Optional[float] = Field(None, ge=0)
    mrc: Optional[float] = Field(None, ge=0)
    phase: Optional[str] = None
    status: Optional[str] = None
    reason: Optional[str] = None
    winner_name: Optional[str] = Field(None, max_length=200)
    winner_tcv: Optional[float] = Field(None, ge=0)


class ScopeOptionIn(BaseModel):
    parent_id: Optional[int] = None
    cat_name: str = Field(..., min_length=1, max_length=100)
    cat_name_ar: Optional[str] = Field(None, max_length=100)


async def require_rfp(conn, module: Module, rfp_id: int, company_id: int):
    """404 unless the RFP exists in this company and module. Used by the sub-module endpoints too."""
    spec = MODULES[module]
    if not await fetch_val(conn, "SELECT 1 FROM rfps WHERE rfp_id=$1 AND company_id=$2 AND module=$3",
                           rfp_id, company_id, spec.code):
        raise HTTPException(status_code=404, detail=f"{spec.noun[0].upper()}{spec.noun[1:]} not found")
    return spec


# ── Scope of work list ────────────────────────────────────────────────────────

def _scope_spec(module: Module) -> ModuleSpec:
    spec = MODULES[module]
    if not spec.scope_type:
        raise HTTPException(status_code=404, detail="This module has no scope of work list")
    return spec


async def _ensure_default_scope(conn, company_id: int, spec: ModuleSpec):
    """Adds the default list once. A company that already has items down to the default list's
    depth is left alone, so removed items stay removed. Items with the same name are reused."""
    defaults = DEFAULT_SCOPES[spec.scope_type]
    depth = 2 if any(children for _, _, children in defaults) else 1
    if await fetch_val(conn, """
            SELECT 1 FROM service_categories WHERE company_id=$1 AND service_type=$2 AND level >= $3 LIMIT 1""",
            company_id, spec.scope_type, depth):
        return

    async def item(parent_id, level, name, name_ar, sort_order):
        cat_id = await fetch_val(conn, """
            SELECT cat_id FROM service_categories
            WHERE company_id=$1 AND service_type=$2 AND is_active=TRUE
              AND parent_id IS NOT DISTINCT FROM $3 AND lower(cat_name)=lower($4)""",
            company_id, spec.scope_type, parent_id, name)
        if cat_id:
            await execute(conn, "UPDATE service_categories SET cat_name_ar=COALESCE(cat_name_ar, $2) WHERE cat_id=$1",
                          cat_id, name_ar)
            return cat_id
        return await fetch_val(conn, """
            INSERT INTO service_categories (company_id, service_type, parent_id, cat_name, cat_name_ar, level, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING cat_id""",
            company_id, spec.scope_type, parent_id, name, name_ar, level, sort_order)

    async with conn.transaction():
        for i, (name, name_ar, children) in enumerate(defaults, 1):
            parent_id = await item(None, 1, name, name_ar, i)
            for j, child in enumerate(children, 1):
                await item(parent_id, 2, child, None, j)


@router.get("/{module}/scope-options")
async def list_scope_options(module: Module, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Flat list of the module's scope tree (parent_id links the levels)."""
    spec = _scope_spec(module)
    company_id = require_company(current_user)
    await _ensure_default_scope(conn, company_id, spec)
    return await fetch_all(conn, """
        SELECT cat_id, parent_id, level, cat_name, cat_name_ar, sort_order
        FROM service_categories
        WHERE company_id=$1 AND service_type=$2 AND is_active=TRUE AND level <= $3
        ORDER BY level, sort_order, lower(cat_name)""", company_id, spec.scope_type, spec.scope_levels)


@router.post("/{module}/scope-options", status_code=201)
async def add_scope_option(module: Module, body: ScopeOptionIn, conn=Depends(get_db),
                           current_user=Depends(require_roles("ADMIN"))):
    spec = _scope_spec(module)
    company_id = require_company(current_user)
    name = body.cat_name.strip()
    level = 1
    if body.parent_id:
        parent = await fetch_one(conn, """
            SELECT level FROM service_categories
            WHERE cat_id=$1 AND company_id=$2 AND service_type=$3 AND is_active=TRUE""",
            body.parent_id, company_id, spec.scope_type)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent item not found")
        if parent["level"] >= spec.scope_levels:
            raise HTTPException(status_code=400, detail=f"This list goes down {spec.scope_levels} levels at most")
        level = parent["level"] + 1
    duplicate = await fetch_val(conn, """
        SELECT 1 FROM service_categories
        WHERE company_id=$1 AND service_type=$2 AND is_active=TRUE
          AND parent_id IS NOT DISTINCT FROM $3 AND lower(cat_name)=lower($4)""",
        company_id, spec.scope_type, body.parent_id, name)
    if duplicate:
        raise HTTPException(status_code=400, detail=f"\"{name}\" is already in this part of the list")
    sort_order = await fetch_val(conn, """
        SELECT COALESCE(MAX(sort_order),0)+1 FROM service_categories
        WHERE company_id=$1 AND service_type=$2 AND parent_id IS NOT DISTINCT FROM $3""",
        company_id, spec.scope_type, body.parent_id)
    cat_id = await fetch_val(conn, """
        INSERT INTO service_categories (company_id, service_type, parent_id, cat_name, cat_name_ar, level, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING cat_id""",
        company_id, spec.scope_type, body.parent_id, name, (body.cat_name_ar or "").strip() or None, level, sort_order)
    return {"cat_id": cat_id, "level": level}


@router.delete("/{module}/scope-options/{cat_id}")
async def remove_scope_option(module: Module, cat_id: int, conn=Depends(get_db),
                              current_user=Depends(require_roles("ADMIN"))):
    """Removes an item and everything under it — unless an RFP uses any of them."""
    spec = _scope_spec(module)
    company_id = require_company(current_user)
    subtree = await fetch_all(conn, """
        WITH RECURSIVE t AS (
            SELECT cat_id FROM service_categories
            WHERE cat_id=$1 AND company_id=$2 AND service_type=$3 AND is_active=TRUE
            UNION ALL
            SELECT c.cat_id FROM service_categories c JOIN t ON c.parent_id=t.cat_id
            WHERE c.is_active=TRUE
        ) SELECT cat_id FROM t""", cat_id, company_id, spec.scope_type)
    if not subtree:
        raise HTTPException(status_code=404, detail="Item not found")
    ids = [r["cat_id"] for r in subtree]
    used = await fetch_val(conn, "SELECT COUNT(DISTINCT rfp_id) FROM rfp_scope WHERE cat_id = ANY($1::int[])", ids)
    if used:
        raise HTTPException(status_code=400,
            detail=f"Used in {used} RFP{'s' if used != 1 else ''}, so it can't be removed")
    await execute(conn, "UPDATE service_categories SET is_active=FALSE WHERE cat_id = ANY($1::int[])", ids)
    return {"message": "Removed", "removed": len(ids)}


# ── Lists and team ────────────────────────────────────────────────────────────

async def _ensure_lists(conn, company_id: int, spec: ModuleSpec):
    for key in spec.lists.values():
        if await fetch_val(conn, "SELECT 1 FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2 LIMIT 1",
                           company_id, key):
            continue
        label, options = LISTS[key]
        for i, (value, opt_label, opt_label_ar) in enumerate(options, 1):
            await execute(conn, """
                INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, option_label_ar, sort_order)
                VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING""",
                company_id, key, label, value, opt_label, opt_label_ar, i)


@router.get("/{module}/lists")
async def get_lists(module: Module, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Drop-down options for the module's form, plus the company's currency (Module 1 / Sub-module A)."""
    spec = MODULES[module]
    company_id = require_company(current_user)
    await _ensure_lists(conn, company_id, spec)
    rows = await fetch_all(conn, """
        SELECT dropdown_key, option_value AS value, option_label AS label, option_label_ar AS label_ar
        FROM dropdown_configs WHERE company_id=$1 AND dropdown_key = ANY($2::text[]) AND is_active=TRUE
        ORDER BY dropdown_key, sort_order""", company_id, list(spec.lists.values()))
    by_key = {}
    for r in rows:
        by_key.setdefault(r.pop("dropdown_key"), []).append(r)
    currency = await fetch_one(conn, """
        SELECT cur.currency_code AS code, cur.symbol, COALESCE(co.currency_decimals, 2) AS decimals
        FROM companies co LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        WHERE co.company_id=$1""", company_id)
    return {"lists": {field: by_key.get(key, []) for field, key in spec.lists.items()},
            "currency": currency, "bid_bond_pcts": list(BID_BOND_PCTS)}


@router.get("/{module}/team-options")
async def team_options(module: Module, conn=Depends(get_db), current_user=Depends(get_current_user)):
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


class TeamMemberIn(BaseModel):
    role: Literal["account_manager", "presales", "bid_manager"]
    full_name: str = Field(..., min_length=1, max_length=150)
    email: Optional[str] = Field(None, max_length=200)


@router.post("/{module}/team-members", status_code=201)
async def add_team_member(module: Module, body: TeamMemberIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Adds a team member from the bid form, so a missing name doesn't stop the user mid-way.
    The same lists are managed in Company Settings (account managers, bid specialists) and Employees (presales)."""
    company_id = require_company(current_user)
    name, email = body.full_name.strip(), (body.email or "").strip() or None
    initials = "".join(w[0] for w in name.split()[:3]).upper() or None
    if body.role == "presales":
        existing = await fetch_val(conn, """SELECT emp_id FROM employees WHERE company_id=$1 AND is_active=TRUE
            AND employee_type='PRESALES' AND lower(full_name)=lower($2)""", company_id, name)
        if existing:
            return {"id": existing, "name": name}
        n = await fetch_val(conn, "SELECT COUNT(*)+1 FROM employees WHERE company_id=$1", company_id)
        code = f"PS-{company_id}-{n}"
        while await fetch_val(conn, "SELECT 1 FROM employees WHERE employee_code=$1", code):
            n += 1
            code = f"PS-{company_id}-{n}"
        emp_id = await fetch_val(conn, """
            INSERT INTO employees (employee_code, full_name, email, employee_type, company_id)
            VALUES ($1,$2,$3,'PRESALES',$4) RETURNING emp_id""", code, name, email or "", company_id)
        return {"id": emp_id, "name": name}
    table, id_col = (("company_account_managers", "am_id") if body.role == "account_manager"
                     else ("company_bid_managers", "bm_id"))
    existing = await fetch_val(conn, f"SELECT {id_col} FROM {table} WHERE company_id=$1 AND is_active=TRUE AND lower(full_name)=lower($2)",
                               company_id, name)
    if existing:
        return {"id": existing, "name": name}
    new_id = await fetch_val(conn, f"INSERT INTO {table} (company_id, full_name, initials, email) VALUES ($1,$2,$3,$4) RETURNING {id_col}",
                             company_id, name, initials, email)
    return {"id": new_id, "name": name}


# ── RFPs ──────────────────────────────────────────────────────────────────────

def _text(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


async def _validated(conn, company_id: int, spec: ModuleSpec, body: RfpIn) -> dict:
    """Checks the form and returns the value of every column in COLUMNS, plus the scope."""
    client_ok = await fetch_val(conn,
        "SELECT 1 FROM clients WHERE client_id=$1 AND company_id=$2 AND is_active=TRUE", body.client_id, company_id)
    if not client_ok:
        raise HTTPException(status_code=400,
            detail="Pick the government entity from the list" if spec.code == "EXPRO" else "Pick a client from the list")
    if spec.ref_required and not _text(body.rfp_ref):
        raise HTTPException(status_code=400, detail="Enter the EXPRO number")
    uses = lambda field: field in spec.fields
    if uses("queries_deadline") and body.queries_deadline and body.queries_deadline > body.submission_date:
        raise HTTPException(status_code=400, detail="The last date for queries must be on or before the submission date")

    pct = None
    if body.bid_bond_required:
        if body.bid_bond_pct not in BID_BOND_PCTS:
            raise HTTPException(status_code=400,
                detail=f"Choose a bid bond percentage: {', '.join(f'{p}%' for p in BID_BOND_PCTS)}")
        pct = body.bid_bond_pct

    scope_ids = sorted(set(body.scope_ids)) if spec.scope_type else []
    if scope_ids:
        rows = await fetch_all(conn, """
            SELECT cat_id, parent_id, level FROM service_categories
            WHERE cat_id = ANY($1::int[]) AND company_id=$2 AND service_type=$3 AND is_active=TRUE AND level <= $4""",
            scope_ids, company_id, spec.scope_type, spec.scope_levels)
        if len(rows) != len(scope_ids):
            raise HTTPException(status_code=400, detail="Some scope items no longer exist — reload and choose again")
        if sum(1 for r in rows if r["parent_id"] is None) > 1:
            raise HTTPException(status_code=400,
                detail="Choose only one family" if spec.code == "TELECOM" else "Choose only one Level 1 scope")
        chosen = set(scope_ids)
        if any(r["parent_id"] is not None and r["parent_id"] not in chosen for r in rows):
            raise HTTPException(status_code=400, detail="Each scope item must sit under an item chosen at the level above")

    await _ensure_lists(conn, company_id, spec)
    v = {field: None for field in ("channel", "project_type", "project_size", "media", "sla", "phase", "status", "reason")}
    for field, key in spec.lists.items():
        value = getattr(body, field)
        if value:
            ok = await fetch_val(conn, """
                SELECT 1 FROM dropdown_configs
                WHERE company_id=$1 AND dropdown_key=$2 AND option_value=$3 AND is_active=TRUE""", company_id, key, value)
            if not ok:
                raise HTTPException(status_code=400, detail=f"\"{value}\" isn't one of the {LISTS[key][0].lower()} options")
        v[field] = value or None
    v["phase"] = v["phase"] or "ON_GOING"
    v["status"] = v["status"] or "PENDING"
    # Keep the record coherent: a drop reason only for dropped/cancelled, the winner only when lost.
    if not (v["phase"] == "DROPPED" or v["status"] in ("DROPPED", "CANCELLED")):
        v["reason"] = None
    lost = v["status"] in LOST_STATUSES

    for field, table, id_col, extra in (
        ("am_id", "company_account_managers", "am_id", ""),
        ("bm_id", "company_bid_managers", "bm_id", ""),
        ("presales_emp_id", "employees", "emp_id", " AND employee_type='PRESALES'"),
    ):
        value = getattr(body, field)
        if value and not await fetch_val(conn,
                f"SELECT 1 FROM {table} WHERE {id_col}=$1 AND company_id=$2 AND is_active=TRUE{extra}", value, company_id):
            raise HTTPException(status_code=400, detail="Pick the team members from the lists")

    optional = {
        "rfp_title": _text(body.rfp_title), "queries_deadline": body.queries_deadline,
        "request_date": body.request_date, "sow": _text(body.sow), "bandwidth_mbps": body.bandwidth_mbps,
        "quantity": body.quantity, "contract_duration": _text(body.contract_duration),
        "coverage_study": _text(body.coverage_study), "location": _text(body.location),
        "attachment_url": _text(body.attachment_url), "presales_comment": _text(body.presales_comment),
        "am_comment": _text(body.am_comment), "bid_comment": _text(body.bid_comment),
        "tcv": body.tcv, "nrc": body.nrc, "mrc": body.mrc,
        "winner_name": _text(body.winner_name) if lost else None, "winner_tcv": body.winner_tcv if lost else None,
    }
    return {
        **{k: (val if uses(k) else None) for k, val in optional.items()},
        **v,  # list fields outside the module's lists stay None
        "client_id": body.client_id, "rfp_ref": _text(body.rfp_ref), "description": _text(body.description),
        "submission_date": body.submission_date, "bid_bond_required": body.bid_bond_required, "bid_bond_pct": pct,
        "am_id": body.am_id, "presales_emp_id": body.presales_emp_id, "bm_id": body.bm_id,
        "scope_ids": scope_ids,
    }


async def _save_scope(conn, rfp_id: int, scope_ids: List[int]):
    await execute(conn, "DELETE FROM rfp_scope WHERE rfp_id=$1", rfp_id)
    for cid in scope_ids:
        await execute(conn, "INSERT INTO rfp_scope (rfp_id, cat_id) VALUES ($1,$2)", rfp_id, cid)


async def _get_rfp(conn, rfp_id: int, company_id: int, spec: ModuleSpec) -> dict:
    rfp = await fetch_one(conn, """
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar,
               c.billing_address_en, c.billing_address_ar, c.is_strategic,
               am.full_name AS am_name, bm.full_name AS bm_name, e.full_name AS presales_name
        FROM rfps r JOIN clients c ON r.client_id=c.client_id
        LEFT JOIN company_account_managers am ON am.am_id=r.am_id
        LEFT JOIN company_bid_managers bm ON bm.bm_id=r.bm_id
        LEFT JOIN employees e ON e.emp_id=r.presales_emp_id
        WHERE r.rfp_id=$1 AND r.company_id=$2 AND r.module=$3""", rfp_id, company_id, spec.code)
    if not rfp:
        raise HTTPException(status_code=404, detail=f"{spec.noun[0].upper()}{spec.noun[1:]} not found")
    rfp["scope"] = await fetch_all(conn, """
        SELECT sc.cat_id, sc.parent_id, sc.level, sc.cat_name, sc.cat_name_ar
        FROM rfp_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
        WHERE s.rfp_id=$1 ORDER BY sc.level, sc.sort_order, sc.cat_name""", rfp_id)
    return rfp


@router.get("/{module}")
async def list_rfps(module: Module, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT r.*, c.name_en AS client_name_en, c.name_ar AS client_name_ar, c.is_strategic,
               am.full_name AS am_name, ev.recommendation AS eval_recommendation, ev.score AS eval_score,
               (r.submission_date - CURRENT_DATE)::INT AS days_to_submission,
               (SELECT sc.cat_name FROM rfp_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
                WHERE s.rfp_id=r.rfp_id AND sc.parent_id IS NULL LIMIT 1) AS scope_level1,
               (SELECT string_agg(sc.cat_name, ', ' ORDER BY sc.sort_order, sc.cat_name)
                FROM rfp_scope s JOIN service_categories sc ON s.cat_id=sc.cat_id
                WHERE s.rfp_id=r.rfp_id AND sc.level = 2) AS scope_level2,
               (SELECT COUNT(*) FROM rfp_scope s WHERE s.rfp_id=r.rfp_id)::INT AS scope_count
        FROM rfps r JOIN clients c ON r.client_id=c.client_id
        LEFT JOIN company_account_managers am ON am.am_id=r.am_id
        LEFT JOIN rfp_evaluations ev ON ev.rfp_id=r.rfp_id
        WHERE r.company_id=$1 AND r.module=$2
        ORDER BY r.created_at DESC""", company_id, MODULES[module].code)


@router.get("/{module}/{rfp_id:int}")
async def get_rfp(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _get_rfp(conn, rfp_id, require_company(current_user), MODULES[module])


@router.post("/{module}", status_code=201)
async def create_rfp(module: Module, body: RfpIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    spec = MODULES[module]
    company_id = require_company(current_user)
    v = await _validated(conn, company_id, spec, body)
    cols = ", ".join(COLUMNS)
    placeholders = ", ".join(f"${i}" for i in range(5, len(COLUMNS) + 5))
    async with conn.transaction():
        n = await fetch_val(conn, f"SELECT nextval('{spec.number_seq}')")
        rfp_number = f"{spec.number_prefix}-{datetime.now().year}-{str(n).zfill(5)}"
        rfp_id = await fetch_val(conn, f"""
            INSERT INTO rfps (company_id, module, rfp_number, created_by, {cols})
            VALUES ($1, $2, $3, $4, {placeholders}) RETURNING rfp_id""",
            company_id, spec.code, rfp_number, current_user.user_id, *(v[c] for c in COLUMNS))
        await _save_scope(conn, rfp_id, v["scope_ids"])
    return await _get_rfp(conn, rfp_id, company_id, spec)


@router.put("/{module}/{rfp_id:int}")
async def update_rfp(module: Module, rfp_id: int, body: RfpIn, conn=Depends(get_db),
                     current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    spec = await require_rfp(conn, module, rfp_id, company_id)
    v = await _validated(conn, company_id, spec, body)
    sets = ", ".join(f"{c}=${i}" for i, c in enumerate(COLUMNS, 1))
    n = len(COLUMNS)
    async with conn.transaction():
        await execute(conn, f"UPDATE rfps SET {sets}, updated_at=NOW() WHERE rfp_id=${n + 1} AND company_id=${n + 2}",
                      *(v[c] for c in COLUMNS), rfp_id, company_id)
        await _save_scope(conn, rfp_id, v["scope_ids"])
    return await _get_rfp(conn, rfp_id, company_id, spec)


@router.delete("/{module}/{rfp_id:int}")
async def delete_rfp(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    spec = MODULES[module]
    result = await execute(conn, "DELETE FROM rfps WHERE rfp_id=$1 AND company_id=$2 AND module=$3",
                           rfp_id, company_id, spec.code)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail=f"{spec.noun[0].upper()}{spec.noun[1:]} not found")
    return {"message": "Deleted"}
