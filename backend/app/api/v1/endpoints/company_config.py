import re
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel, Field
from app.db.postgres import get_db, fetch_all, fetch_one, execute, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser

router = APIRouter(prefix="/company-config", tags=["Company Config"])

class AMCreate(BaseModel):
    user_id: Optional[int] = None
    emp_id: Optional[int] = None
    full_name: str
    initials: Optional[str] = None
    email: Optional[str] = None

class BMCreate(BaseModel):
    user_id: Optional[int] = None
    emp_id: Optional[int] = None
    full_name: str
    initials: Optional[str] = None
    email: Optional[str] = None

class EvaluatorCreate(BaseModel):
    full_name: str
    email: Optional[str] = None
    title: str

class PricingApprovalUpdate(BaseModel):
    l1_title: str = Field("Bid Department Manager", min_length=1, max_length=100)
    l2_title: str = Field("Sales VP", min_length=1, max_length=100)
    l3_title: str = Field("Finance", min_length=1, max_length=100)
    telecom_l1_max_discount: Optional[float] = Field(None, ge=0, le=100)
    telecom_l2_max_discount: Optional[float] = Field(None, ge=0, le=100)
    ict_l1_min_margin: Optional[float] = Field(None, ge=0, le=100)
    ict_l2_min_margin: Optional[float] = Field(None, ge=0, le=100)
    ebitda_min_pct: Optional[float] = Field(None, ge=-100, le=100)

class BondApprovalUpdate(BaseModel):
    l1_title: str = Field("Bid Department Manager", min_length=1, max_length=100)
    l2_title: str = Field("VP Sales", min_length=1, max_length=100)
    l3_title: str = Field("Finance", min_length=1, max_length=100)
    office_name: str = Field("Bid Bond Issuance Office", min_length=1, max_length=150)
    office_email: Optional[str] = Field(None, max_length=500)
    auto_send: bool = True

BOND_APPROVAL_DEFAULTS = {
    "l1_title": "Bid Department Manager", "l2_title": "VP Sales", "l3_title": "Finance",
    "office_name": "Bid Bond Issuance Office", "office_email": None, "auto_send": True,
}

_EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")

def normalize_email_list(raw: Optional[str]) -> Optional[str]:
    """'a@x.com; b@y.com' -> 'a@x.com, b@y.com'. Raises ValueError naming the first bad address."""
    if not raw or not raw.strip():
        return None
    parts = [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]
    for p in parts:
        if not _EMAIL_RE.match(p):
            raise ValueError(p)
    return ", ".join(parts)

PRICING_DEFAULTS = {
    "l1_title": "Bid Department Manager", "l2_title": "Sales VP", "l3_title": "Finance",
    "telecom_l1_max_discount": None, "telecom_l2_max_discount": None,
    "ict_l1_min_margin": None, "ict_l2_min_margin": None, "ebitda_min_pct": None,
}

class CompanyUpdate(BaseModel):
    company_name: Optional[str] = None
    company_name_ar: Optional[str] = None
    company_initials: Optional[str] = None
    activation_code: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    # Module 1 (Company) / Sub-module A
    country: Optional[str] = None
    currency_id: Optional[int] = None
    currency_decimals: Optional[int] = None
    services_ict: Optional[bool] = None
    services_telecom: Optional[bool] = None

@router.get("")
async def get_company(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, "SELECT * FROM companies WHERE company_id=$1", company_id)

@router.get("/currencies")
async def list_currencies(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT currency_id, currency_code, currency_name, symbol FROM currencies ORDER BY currency_code")

@router.patch("")
async def update_company(body: CompanyUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    provided = body.dict(exclude_unset=True)

    if "currency_decimals" in provided and provided["currency_decimals"] not in (2, 3, 4):
        raise HTTPException(status_code=400, detail="Currency decimals must be 2, 3, or 4")

    if provided.get("services_ict") is False and provided.get("services_telecom") is False:
        raise HTTPException(status_code=400, detail="Select at least one service offered (ICT, Telecom, or both)")

    allowed = [
        "company_name","company_name_ar","company_initials","activation_code","address","phone","email","website",
        "country","currency_id","currency_decimals","services_ict","services_telecom",
    ]
    updates, args = [], []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(company_id)
    await execute(conn, f"UPDATE companies SET {','.join(updates)} WHERE company_id=${len(args)}", *args)
    return {"message": "Company updated"}

# Account Managers
@router.get("/account-managers")
async def list_ams(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, "SELECT * FROM company_account_managers WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name", company_id)

@router.post("/account-managers", status_code=201)
async def add_am(body: AMCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    # Auto-get initials from employee if emp_id provided
    initials = body.initials
    if body.emp_id and not initials:
        emp = await fetch_one(conn, "SELECT initials FROM employees WHERE emp_id=$1 AND company_id=$2", body.emp_id, company_id)
        if emp: initials = emp["initials"]
    await execute(conn,
        "INSERT INTO company_account_managers (company_id, user_id, emp_id, full_name, initials, email) VALUES ($1,$2,$3,$4,$5,$6)",
        company_id, body.user_id, body.emp_id, body.full_name, initials, body.email)
    return {"message": "Account manager added"}

@router.delete("/account-managers/{am_id}")
async def remove_am(am_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE company_account_managers SET is_active=FALSE WHERE am_id=$1 AND company_id=$2", am_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Account manager not found")
    return {"message": "Removed"}

# Bid Specialists / Managers
@router.get("/bid-managers")
async def list_bms(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, "SELECT * FROM company_bid_managers WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name", company_id)

@router.post("/bid-managers", status_code=201)
async def add_bm(body: BMCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    initials = body.initials
    if body.emp_id and not initials:
        emp = await fetch_one(conn, "SELECT initials FROM employees WHERE emp_id=$1 AND company_id=$2", body.emp_id, company_id)
        if emp: initials = emp["initials"]
    await execute(conn,
        "INSERT INTO company_bid_managers (company_id, user_id, emp_id, full_name, initials, email) VALUES ($1,$2,$3,$4,$5,$6)",
        company_id, body.user_id, body.emp_id, body.full_name, initials, body.email)
    return {"message": "Bid manager added"}

@router.delete("/bid-managers/{bm_id}")
async def remove_bm(bm_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE company_bid_managers SET is_active=FALSE WHERE bm_id=$1 AND company_id=$2", bm_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Bid manager not found")
    return {"message": "Removed"}

# Evaluators (Module 1 / Sub-module B) — "title" is referenced by Module 2's evaluation process
@router.get("/evaluators")
async def list_evaluators(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, "SELECT * FROM company_evaluators WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name", company_id)

@router.post("/evaluators", status_code=201)
async def add_evaluator(body: EvaluatorCreate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await execute(conn,
        "INSERT INTO company_evaluators (company_id, full_name, email, title) VALUES ($1,$2,$3,$4)",
        company_id, body.full_name, body.email, body.title)
    return {"message": "Evaluator added"}

@router.delete("/evaluators/{evaluator_id}")
async def remove_evaluator(evaluator_id: int, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    result = await execute(conn, "UPDATE company_evaluators SET is_active=FALSE WHERE evaluator_id=$1 AND company_id=$2", evaluator_id, company_id)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Evaluator not found")
    return {"message": "Removed"}

# Pricing Approval Cycle (Module 1 / Sub-module C)
@router.get("/pricing-approval")
async def get_pricing_approval(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    row = await fetch_one(conn, "SELECT * FROM company_pricing_approval WHERE company_id=$1", company_id)
    return row or {"company_id": company_id, **PRICING_DEFAULTS}

@router.put("/pricing-approval")
async def save_pricing_approval(body: PricingApprovalUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    d1, d2 = body.telecom_l1_max_discount, body.telecom_l2_max_discount
    if d1 is not None and d2 is not None and d1 > d2:
        raise HTTPException(status_code=400, detail="Telecom: Level 2's maximum discount must be at least Level 1's")
    m1, m2 = body.ict_l1_min_margin, body.ict_l2_min_margin
    if m1 is not None and m2 is not None and m1 < m2:
        raise HTTPException(status_code=400, detail="ICT: Level 2's minimum margin must not be higher than Level 1's")
    await execute(conn, """
        INSERT INTO company_pricing_approval
            (company_id, l1_title, l2_title, l3_title, telecom_l1_max_discount, telecom_l2_max_discount,
             ict_l1_min_margin, ict_l2_min_margin, ebitda_min_pct, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (company_id) DO UPDATE SET
            l1_title=EXCLUDED.l1_title, l2_title=EXCLUDED.l2_title, l3_title=EXCLUDED.l3_title,
            telecom_l1_max_discount=EXCLUDED.telecom_l1_max_discount,
            telecom_l2_max_discount=EXCLUDED.telecom_l2_max_discount,
            ict_l1_min_margin=EXCLUDED.ict_l1_min_margin, ict_l2_min_margin=EXCLUDED.ict_l2_min_margin,
            ebitda_min_pct=EXCLUDED.ebitda_min_pct, updated_at=NOW()
    """, company_id, body.l1_title.strip(), body.l2_title.strip(), body.l3_title.strip(),
        d1, d2, m1, m2, body.ebitda_min_pct)
    return {"message": "Pricing approval cycle saved"}

# Bid Bond Approval Cycle (Module 1 / Sub-module D)
async def get_bond_approval_config(conn, company_id: int) -> dict:
    row = await fetch_one(conn, "SELECT * FROM company_bond_approval WHERE company_id=$1", company_id)
    return dict(row) if row else {"company_id": company_id, **BOND_APPROVAL_DEFAULTS}

@router.get("/bond-approval")
async def get_bond_approval(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await get_bond_approval_config(conn, require_company(current_user))

@router.put("/bond-approval")
async def save_bond_approval(body: BondApprovalUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    try:
        office_email = normalize_email_list(body.office_email)
    except ValueError as bad:
        raise HTTPException(status_code=400, detail=f"Not a valid email address: {bad}")
    if body.auto_send and not office_email:
        raise HTTPException(status_code=400, detail="Enter the issuance office's email address, or turn off automatic sending")
    await execute(conn, """
        INSERT INTO company_bond_approval (company_id, l1_title, l2_title, l3_title, office_name, office_email, auto_send, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (company_id) DO UPDATE SET
            l1_title=EXCLUDED.l1_title, l2_title=EXCLUDED.l2_title, l3_title=EXCLUDED.l3_title,
            office_name=EXCLUDED.office_name, office_email=EXCLUDED.office_email,
            auto_send=EXCLUDED.auto_send, updated_at=NOW()
    """, company_id, body.l1_title.strip(), body.l2_title.strip(), body.l3_title.strip(),
        body.office_name.strip(), office_email, body.auto_send)
    return {"message": "Bid bond approval cycle saved"}


@router.get("/setup-status")
async def setup_status(conn=Depends(get_db), current_user=Depends(get_current_user)):
    """What a new company still has to set up before the bid modules work smoothly (Dashboard checklist)."""
    company_id = require_company(current_user)
    one = lambda sql: fetch_one(conn, sql, company_id)
    co = await one("""SELECT company_initials, country, currency_id, services_ict, services_telecom FROM companies WHERE company_id=$1""")
    counts = await one("""
        SELECT (SELECT COUNT(*) FROM company_evaluators WHERE company_id=$1 AND is_active) AS evaluators,
               (SELECT COUNT(*) FROM company_pricing_approval WHERE company_id=$1) AS pricing,
               (SELECT COUNT(*) FROM company_bond_approval WHERE company_id=$1 AND COALESCE(office_email,'') <> '') AS bond,
               (SELECT COUNT(*) FROM company_account_managers WHERE company_id=$1 AND is_active) AS ams,
               (SELECT COUNT(*) FROM company_bid_managers WHERE company_id=$1 AND is_active) AS bms,
               (SELECT COUNT(*) FROM employees WHERE company_id=$1 AND is_active AND employee_type='PRESALES') AS presales,
               (SELECT COUNT(*) FROM rfp_eval_questions WHERE company_id=$1 AND is_active AND module='ICT') AS q_ict,
               (SELECT COUNT(*) FROM rfp_eval_questions WHERE company_id=$1 AND is_active AND module='TELECOM') AS q_tel,
               (SELECT COUNT(*) FROM rfp_eval_questions WHERE company_id=$1 AND is_active AND module='EXPRO') AS q_expro""")
    steps = [
        ("profile", "Company profile: initials, country, currency and services",
         bool(co and co["company_initials"] and co["country"] and co["currency_id"] and (co["services_ict"] or co["services_telecom"])),
         "/company-settings"),
        ("evaluators", "Add evaluators (name, email, title)", counts["evaluators"] > 0, "/company-settings"),
        ("pricing", "Set the pricing approval cycle", counts["pricing"] > 0, "/company-settings"),
        ("bond", "Set the bid bond approval cycle and the issuance office email", counts["bond"] > 0, "/company-settings"),
        ("team", "Add the team: account managers, bid specialists and presales",
         counts["ams"] > 0 and counts["bms"] > 0 and counts["presales"] > 0, "/company-settings"),
        ("q_ict", "RFP ICT: set the evaluation questions", counts["q_ict"] > 0, "/rfp-ict?tab=questions"),
        ("q_tel", "RFP Telecom: set the evaluation questions", counts["q_tel"] > 0, "/rfp-telecom?tab=questions"),
        ("q_expro", "EXPRO: set the evaluation questions", counts["q_expro"] > 0, "/expro-requests?tab=questions"),
    ]
    return {"steps": [{"id": i, "label": l, "done": d, "link": k} for i, l, d, k in steps]}
