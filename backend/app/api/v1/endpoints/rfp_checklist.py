"""Sub-module C of Modules 2–4 (after B, the bid bond) — the RFP checklist.

- Site visit: Yes / No; if Yes, the sales person assigned to it.
- Others — special terms and conditions: if there are any, the bid manager attaches the documents
  and sends them by email to Contracting (set in Company Settings → Approvals). Contracting's answer
  (Approved / Not approved) is recorded here and the bid manager is told the outcome.
  EXPRO bids have no checklist.
- Insurance: Yes / No; if Yes, the policies the client requires, picked from a list that
  users can add to (System Settings → Dropdowns → Insurance policy).
"""
import html
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user
from app.api.v1.endpoints.rfps import Module, require_rfp
from app.services.email_service import send_email, smtp_configured

from app.services.plan import module_enabled

router = APIRouter(prefix="/rfps", tags=["RFP checklist"], dependencies=[Depends(module_enabled)])

MAX_FILE_BYTES = 10 * 1024 * 1024     # per attachment
MAX_TOTAL_BYTES = 20 * 1024 * 1024    # all attachments of one bid (they go in one email)
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


def _no_expro(module: Module):
    if module == Module.expro:
        raise HTTPException(status_code=404, detail="EXPRO bids have no checklist")


async def _payload(conn, module: Module, rfp_id: int, current_user) -> dict:
    _no_expro(module)
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    checklist = await fetch_one(conn, """
        SELECT k.*, am.full_name AS site_visit_am_name
        FROM rfp_checklists k LEFT JOIN company_account_managers am ON am.am_id = k.site_visit_am_id
        WHERE k.rfp_id=$1""", rfp_id)
    bid_manager = await fetch_one(conn, """
        SELECT bm.full_name, bm.email FROM rfps r JOIN company_bid_managers bm ON bm.bm_id = r.bm_id
        WHERE r.rfp_id=$1""", rfp_id)
    contracting = await fetch_one(conn, """
        SELECT contracting_name AS name, contracting_email AS email FROM company_pricing_approval WHERE company_id=$1""", company_id)
    return {
        "files": await fetch_all(conn, """
            SELECT file_id, filename, content_type, size_bytes, uploaded_by, uploaded_at
            FROM rfp_checklist_files WHERE rfp_id=$1 ORDER BY file_id""", rfp_id),
        "contracting": contracting or {"name": "Contracting", "email": None},
        "checklist": checklist,
        "policies": await _policies(conn, company_id),
        "salesmen": await fetch_all(conn, """
            SELECT am_id AS id, full_name AS name FROM company_account_managers
            WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name""", company_id),
        "bid_manager": bid_manager,
    }


async def _tell_bid_manager(conn, rfp_id: int, company_id: int, subject: str, lines: List[str],
                            notif_type: str = "RFP_TERMS"):
    """Email the RFP's bid manager (when email is set up) and add an in-app notification."""
    bm = await fetch_one(conn, """
        SELECT bm.user_id, bm.email, bm.full_name, r.rfp_number FROM rfps r
        JOIN company_bid_managers bm ON bm.bm_id = r.bm_id WHERE r.rfp_id=$1""", rfp_id)
    if not bm:
        return
    title = f"{bm['rfp_number']}: {subject}"
    if bm["user_id"]:
        await execute(conn, "INSERT INTO notifications (user_id, notif_type, title, body, company_id) VALUES ($1,$2,$3,$4,$5)",
                      bm["user_id"], notif_type, title[:200], "\n".join(lines), company_id)
    if bm["email"] and await smtp_configured(company_id):
        body = "".join(f"<p>{html.escape(l)}</p>" for l in lines)
        await send_email(bm["email"], title, body, "\n".join(lines), company_id)


@router.get("/{module}/{rfp_id:int}/checklist")
async def get_checklist(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _payload(conn, module, rfp_id, current_user)


@router.put("/{module}/{rfp_id:int}/checklist")
async def save_checklist(module: Module, rfp_id: int, body: ChecklistIn, conn=Depends(get_db),
                         current_user=Depends(get_current_user)):
    _no_expro(module)
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
            # New or changed terms have to be sent to Contracting (again).
            await execute(conn, """
                UPDATE rfp_checklists SET special_terms_decided_by=NULL, special_terms_decider_name=NULL,
                       special_terms_decided_at=NULL, special_terms_note=NULL, special_terms_sent_at=NULL,
                       special_terms_sent_to=NULL, special_terms_sent_by=NULL, special_terms_send_error=NULL
                WHERE rfp_id=$1""", rfp_id)
    return await _payload(conn, module, rfp_id, current_user)


async def _terms_row(conn, module: Module, rfp_id: int, company_id: int):
    _no_expro(module)
    await require_rfp(conn, module, rfp_id, company_id)
    row = await fetch_one(conn, "SELECT special_terms FROM rfp_checklists WHERE rfp_id=$1", rfp_id)
    if not row or not row["special_terms"]:
        raise HTTPException(status_code=400, detail="Save the special terms and conditions first")
    return row


@router.post("/{module}/{rfp_id:int}/checklist/files", status_code=201)
async def upload_terms_file(module: Module, rfp_id: int, file: UploadFile = File(...), conn=Depends(get_db),
                            current_user=Depends(get_current_user)):
    """A document for Contracting (the terms, the client's RFP pages, …), sent with the email."""
    company_id = require_company(current_user)
    _no_expro(module)
    await require_rfp(conn, module, rfp_id, company_id)
    data = await file.read(MAX_FILE_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="A file can be at most 10 MB")
    total = await fetch_val(conn, "SELECT COALESCE(SUM(size_bytes),0) FROM rfp_checklist_files WHERE rfp_id=$1", rfp_id)
    if total + len(data) > MAX_TOTAL_BYTES:
        raise HTTPException(status_code=400, detail="All attachments together can be at most 20 MB, so they fit in one email")
    name = (file.filename or "attachment").replace("\\", "/").split("/")[-1][:255]
    file_id = await fetch_val(conn, """
        INSERT INTO rfp_checklist_files (rfp_id, filename, content_type, size_bytes, data, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING file_id""",
        rfp_id, name, (file.content_type or "application/octet-stream")[:150], len(data), data, current_user.full_name)
    return {"file_id": file_id, "filename": name, "size_bytes": len(data)}


@router.get("/{module}/{rfp_id:int}/checklist/files/{file_id:int}")
async def download_terms_file(module: Module, rfp_id: int, file_id: int, conn=Depends(get_db),
                              current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    _no_expro(module)
    await require_rfp(conn, module, rfp_id, company_id)
    f = await fetch_one(conn, "SELECT filename, content_type, data FROM rfp_checklist_files WHERE file_id=$1 AND rfp_id=$2",
                        file_id, rfp_id)
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    safe = f["filename"].replace('"', "")
    return Response(content=bytes(f["data"]), media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.delete("/{module}/{rfp_id:int}/checklist/files/{file_id:int}")
async def delete_terms_file(module: Module, rfp_id: int, file_id: int, conn=Depends(get_db),
                            current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    _no_expro(module)
    await require_rfp(conn, module, rfp_id, company_id)
    if await execute(conn, "DELETE FROM rfp_checklist_files WHERE file_id=$1 AND rfp_id=$2", file_id, rfp_id) == "DELETE 0":
        raise HTTPException(status_code=404, detail="File not found")
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/checklist/special-terms/send")
async def send_terms_to_contracting(module: Module, rfp_id: int, conn=Depends(get_db),
                                    current_user=Depends(get_current_user)):
    """Emails the special terms, with every attachment, to Contracting for approval."""
    company_id = require_company(current_user)
    row = await _terms_row(conn, module, rfp_id, company_id)
    cfg = await fetch_one(conn, "SELECT contracting_name, contracting_email FROM company_pricing_approval WHERE company_id=$1",
                          company_id)
    error = None
    if not cfg or not cfg["contracting_email"]:
        error = "No Contracting email is set (Company Settings → C · Approvals), so nothing was sent"
    elif not await smtp_configured(company_id):
        error = "Email isn't set up or is switched off (System Settings → Email), so nothing was sent"
    else:
        info = await fetch_one(conn, """
            SELECT r.rfp_number, r.rfp_title, r.rfp_ref, r.submission_date, c.name_en, bm.full_name AS bm_name
            FROM rfps r JOIN clients c ON c.client_id = r.client_id
            LEFT JOIN company_bid_managers bm ON bm.bm_id = r.bm_id WHERE r.rfp_id=$1""", rfp_id)
        files = await fetch_all(conn, "SELECT filename, content_type, data FROM rfp_checklist_files WHERE rfp_id=$1 ORDER BY file_id", rfp_id)
        lines = [f"Dear {cfg['contracting_name']},",
                 f"Please review and approve the special terms and conditions for bid {info['rfp_number']}"
                 + (f" ({info['rfp_ref']})" if info["rfp_ref"] else "") + f" — {info['name_en']}"
                 + (f" — {info['rfp_title']}" if info["rfp_title"] else "") + ".",
                 f"Submission date: {info['submission_date']:%d %b %Y}",
                 "Special terms and conditions:", row["special_terms"]]
        if files:
            lines.append(f"Attached: {', '.join(f['filename'] for f in files)}")
        lines.append(f"Sent by {current_user.full_name}" + (f" for bid manager {info['bm_name']}" if info["bm_name"] and info["bm_name"] != current_user.full_name else "") + ".")
        subject = f"{info['rfp_number']}: special terms for approval — {info['name_en']}"
        ok = await send_email(cfg["contracting_email"], subject, "".join(f"<p>{html.escape(l)}</p>".replace("\n", "<br>") for l in lines),
                              "\n\n".join(lines), company_id, attachments=[(f["filename"], f["content_type"], bytes(f["data"])) for f in files])
        if not ok:
            error = "The email server didn't accept the message — check the Contracting address and email settings, then send again"
    if error:
        await execute(conn, "UPDATE rfp_checklists SET special_terms_send_error=$2 WHERE rfp_id=$1", rfp_id, error)
        raise HTTPException(status_code=400, detail=error)
    await execute(conn, """
        UPDATE rfp_checklists SET special_terms_sent_at=NOW(), special_terms_sent_to=$2, special_terms_sent_by=$3,
               special_terms_send_error=NULL, special_terms_status='PENDING' WHERE rfp_id=$1""",
        rfp_id, cfg["contracting_email"], current_user.full_name)
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/checklist/special-terms")
async def decide_special_terms(module: Module, rfp_id: int, body: DecisionIn, conn=Depends(get_db),
                               current_user=Depends(get_current_user)):
    """Records Contracting's answer (they reply to the email)."""
    company_id = require_company(current_user)
    row = await _terms_row(conn, module, rfp_id, company_id)
    note = (body.note or "").strip() or None
    await execute(conn, """
        UPDATE rfp_checklists SET special_terms_status=$2, special_terms_decided_by=$3, special_terms_decider_name=$4,
               special_terms_decided_at=NOW(), special_terms_note=$5 WHERE rfp_id=$1""",
        rfp_id, body.decision, current_user.user_id, current_user.full_name, note)
    word = "approved" if body.decision == "APPROVED" else "not approved"
    await _tell_bid_manager(conn, rfp_id, company_id, f"special terms {word}",
                            [f"Contracting's answer: the special terms and conditions are {word} (recorded by {current_user.full_name}).",
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
