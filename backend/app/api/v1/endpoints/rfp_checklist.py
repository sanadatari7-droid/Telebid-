"""Sub-module C of Modules 2–4 (after B, the bid bond) — the RFP checklist.

- Site visit: Yes / No; if Yes, the sales person assigned to it.
- Others — special terms and conditions: if there are any, the bid department approves
  them (Approved / Not approved) and the RFP's bid manager is told the outcome.
- Insurance: Yes / No; if Yes, the policies the client requires, picked from a list that
  users can add to (System Settings → Dropdowns → Insurance policy).
"""
import html
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user
from app.api.v1.endpoints.rfps import Module, require_rfp
from app.services.email_service import send_email, smtp_configured

router = APIRouter(prefix="/rfps", tags=["RFP checklist"])

# Who decides on special terms and conditions: the bid department.
DECIDER_ROLES = ("ADMIN", "DEPT_MANAGER")
POLICY_LIST = "insurance_policy"
DEFAULT_POLICIES = [
    ("GENERAL_LIABILITY", "General liability insurance", "تأمين المسؤولية العامة"),
    ("PROFESSIONAL_INDEMNITY", "Professional indemnity insurance", "تأمين المسؤولية المهنية"),
    ("WORK_COMPENSATION", "Work compensation insurance", "تأمين تعويض العمال"),
]


class ChecklistIn(BaseModel):
    site_visit_required: bool
    site_visit_am_id: Optional[int] = None
    special_terms_required: bool
    special_terms: Optional[str] = Field(None, max_length=5000)
    insurance_required: bool
    insurance_policies: List[str] = Field(default_factory=list)


class DecisionIn(BaseModel):
    decision: Literal["APPROVED", "NOT_APPROVED"]
    note: Optional[str] = Field(None, max_length=1000)


class PolicyIn(BaseModel):
    label: str = Field(..., min_length=1, max_length=150)


async def _ensure_policies(conn, company_id: int):
    if await fetch_val(conn, "SELECT 1 FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2 LIMIT 1",
                       company_id, POLICY_LIST):
        return
    for i, (value, label, label_ar) in enumerate(DEFAULT_POLICIES, 1):
        await execute(conn, """
            INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, option_label_ar, sort_order)
            VALUES ($1,$2,'Insurance policy',$3,$4,$5,$6) ON CONFLICT DO NOTHING""",
            company_id, POLICY_LIST, value, label, label_ar, i)


async def _policies(conn, company_id: int) -> list:
    await _ensure_policies(conn, company_id)
    return await fetch_all(conn, """
        SELECT option_value AS value, option_label AS label, option_label_ar AS label_ar
        FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2 AND is_active=TRUE
        ORDER BY sort_order, option_label""", company_id, POLICY_LIST)


async def _payload(conn, module: Module, rfp_id: int, current_user) -> dict:
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    checklist = await fetch_one(conn, """
        SELECT k.*, am.full_name AS site_visit_am_name
        FROM rfp_checklists k LEFT JOIN company_account_managers am ON am.am_id = k.site_visit_am_id
        WHERE k.rfp_id=$1""", rfp_id)
    bid_manager = await fetch_one(conn, """
        SELECT bm.full_name, bm.email FROM rfps r JOIN company_bid_managers bm ON bm.bm_id = r.bm_id
        WHERE r.rfp_id=$1""", rfp_id)
    return {
        "checklist": checklist,
        "policies": await _policies(conn, company_id),
        "salesmen": await fetch_all(conn, """
            SELECT am_id AS id, full_name AS name FROM company_account_managers
            WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name""", company_id),
        "bid_manager": bid_manager,
        "can_decide": current_user.has_role(*DECIDER_ROLES),
    }


async def _tell_bid_manager(conn, rfp_id: int, company_id: int, subject: str, lines: List[str]):
    """Email the RFP's bid manager (when email is set up) and add an in-app notification."""
    bm = await fetch_one(conn, """
        SELECT bm.user_id, bm.email, bm.full_name, r.rfp_number FROM rfps r
        JOIN company_bid_managers bm ON bm.bm_id = r.bm_id WHERE r.rfp_id=$1""", rfp_id)
    if not bm:
        return
    title = f"{bm['rfp_number']}: {subject}"
    if bm["user_id"]:
        await execute(conn, "INSERT INTO notifications (user_id, notif_type, title, body, company_id) VALUES ($1,'RFP_TERMS',$2,$3,$4)",
                      bm["user_id"], title[:200], "\n".join(lines), company_id)
    if bm["email"] and await smtp_configured(company_id):
        body = "".join(f"<p>{html.escape(l)}</p>" for l in lines)
        await send_email(bm["email"], title, body, "\n".join(lines), company_id)


@router.get("/{module}/{rfp_id:int}/checklist")
async def get_checklist(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _payload(conn, module, rfp_id, current_user)


@router.put("/{module}/{rfp_id:int}/checklist")
async def save_checklist(module: Module, rfp_id: int, body: ChecklistIn, conn=Depends(get_db),
                         current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)

    am_id = None
    if body.site_visit_required:
        if not body.site_visit_am_id or not await fetch_val(conn,
                "SELECT 1 FROM company_account_managers WHERE am_id=$1 AND company_id=$2 AND is_active=TRUE",
                body.site_visit_am_id, company_id):
            raise HTTPException(status_code=400, detail="Choose the sales person assigned to the site visit")
        am_id = body.site_visit_am_id

    terms = (body.special_terms or "").strip() or None
    if body.special_terms_required and not terms:
        raise HTTPException(status_code=400, detail="Write the special terms and conditions")
    if not body.special_terms_required:
        terms = None

    policies = []
    if body.insurance_required:
        valid = {p["value"] for p in await _policies(conn, company_id)}
        policies = list(dict.fromkeys(body.insurance_policies))
        if not policies:
            raise HTTPException(status_code=400, detail="Choose the insurance policies the client requires")
        if any(p not in valid for p in policies):
            raise HTTPException(status_code=400, detail="An insurance policy isn't in the list — reload and choose again")

    old = await fetch_one(conn, "SELECT special_terms, special_terms_status FROM rfp_checklists WHERE rfp_id=$1", rfp_id)
    # New or changed terms go (back) to the bid department for approval.
    changed = terms is not None and (not old or old["special_terms"] != terms)
    status = None if terms is None else ("PENDING" if changed else old["special_terms_status"])

    async with conn.transaction():
        await execute(conn, """
            INSERT INTO rfp_checklists (rfp_id, site_visit_required, site_visit_am_id, special_terms_required, special_terms,
                   special_terms_status, insurance_required, insurance_policies, updated_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
            ON CONFLICT (rfp_id) DO UPDATE SET site_visit_required=EXCLUDED.site_visit_required,
                site_visit_am_id=EXCLUDED.site_visit_am_id, special_terms_required=EXCLUDED.special_terms_required,
                special_terms=EXCLUDED.special_terms, special_terms_status=EXCLUDED.special_terms_status,
                insurance_required=EXCLUDED.insurance_required, insurance_policies=EXCLUDED.insurance_policies,
                updated_by=EXCLUDED.updated_by, updated_at=NOW()""",
            rfp_id, body.site_visit_required, am_id, body.special_terms_required, terms, status,
            body.insurance_required, policies, current_user.user_id)
        if changed or terms is None:
            await execute(conn, """
                UPDATE rfp_checklists SET special_terms_decided_by=NULL, special_terms_decider_name=NULL,
                       special_terms_decided_at=NULL, special_terms_note=NULL WHERE rfp_id=$1""", rfp_id)
    if changed:
        await _tell_bid_manager(conn, rfp_id, company_id, "special terms waiting for bid department approval",
                                ["These special terms and conditions were added and are waiting for the bid department's approval:", terms])
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/checklist/special-terms")
async def decide_special_terms(module: Module, rfp_id: int, body: DecisionIn, conn=Depends(get_db),
                               current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    if not current_user.has_role(*DECIDER_ROLES):
        raise HTTPException(status_code=403, detail="Only the bid department can approve special terms and conditions")
    row = await fetch_one(conn, "SELECT special_terms FROM rfp_checklists WHERE rfp_id=$1", rfp_id)
    if not row or not row["special_terms"]:
        raise HTTPException(status_code=400, detail="There are no special terms and conditions to approve")
    note = (body.note or "").strip() or None
    await execute(conn, """
        UPDATE rfp_checklists SET special_terms_status=$2, special_terms_decided_by=$3, special_terms_decider_name=$4,
               special_terms_decided_at=NOW(), special_terms_note=$5 WHERE rfp_id=$1""",
        rfp_id, body.decision, current_user.user_id, current_user.full_name, note)
    word = "approved" if body.decision == "APPROVED" else "not approved"
    await _tell_bid_manager(conn, rfp_id, company_id, f"special terms {word}",
                            [f"The bid department ({current_user.full_name}) marked the special terms and conditions as {word}.",
                             row["special_terms"], *([f"Note: {note}"] if note else [])])
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/insurance-policies", status_code=201)
async def add_policy(module: Module, body: PolicyIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Adds a policy to the company's list so it can be ticked on any RFP."""
    company_id = require_company(current_user)
    label = body.label.strip()
    existing = await _policies(conn, company_id)
    match = next((p for p in existing if p["label"].lower() == label.lower()), None)
    if match:
        return match
    value = "".join(ch if ch.isalnum() else "_" for ch in label.upper()).strip("_")[:60] or "POLICY"
    base, n = value, 2
    while await fetch_val(conn, "SELECT 1 FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2 AND option_value=$3",
                          company_id, POLICY_LIST, value):
        value, n = f"{base}_{n}", n + 1
    sort_order = await fetch_val(conn, "SELECT COALESCE(MAX(sort_order),0)+1 FROM dropdown_configs WHERE company_id=$1 AND dropdown_key=$2",
                                 company_id, POLICY_LIST)
    await execute(conn, """
        INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, sort_order)
        VALUES ($1,$2,'Insurance policy',$3,$4,$5)""", company_id, POLICY_LIST, value, label, sort_order)
    return {"value": value, "label": label, "label_ar": None}
