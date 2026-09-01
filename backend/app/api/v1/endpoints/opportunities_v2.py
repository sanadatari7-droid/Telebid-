from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from datetime import datetime, date
import json
from pydantic import BaseModel, validator
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from app.services.email_service import send_bid_notification

router = APIRouter(prefix="/opportunities-v2", tags=["Opportunities V2"])

# ── Models ────────────────────────────────────────────────────────────────────

class OppCreate(BaseModel):
    customer_name: str
    customer_name_ar: Optional[str] = None
    customer_id: Optional[str] = None
    customer_type: str = "CORPORATE"
    is_strategic: bool = False
    source_customer_rfp: bool = False
    source_government: bool = False
    source_etimad: bool = False
    source_expro: bool = False
    source_forsah: bool = False
    source_wholesales: bool = False
    source_single: Optional[str] = None   # ETIMAD, EMAIL, CLIENT, PORTAL (radio - single choice)
    project_type: Optional[str] = None
    service_type: Optional[str] = None    # TELECOM or ICT
    service_cat_l1: Optional[int] = None  # Level 1 category
    service_cat_l2: Optional[int] = None  # Level 2 category
    expro_ref: Optional[str] = None
    rfp_ref: Optional[str] = None
    family_id: Optional[int] = None
    solution_id: Optional[int] = None
    solution_detail: Optional[str] = None
    media_type: Optional[str] = None
    sla_type: Optional[str] = None
    bandwidth_mbps: Optional[float] = None
    quantity: int = 1
    contract_duration: Optional[str] = None
    coverage_study: Optional[str] = None
    nrc: Optional[float] = None
    mrc: Optional[float] = None
    tcv: Optional[float] = None
    currency_id: int = 1
    project_size: Optional[str] = None
    description: Optional[str] = None
    sow_detail: Optional[str] = None
    location_text: Optional[str] = None
    attachment_url: Optional[str] = None
    notes: Optional[str] = None
    sales_rep_id: Optional[int] = None
    presales_id: Optional[int] = None
    bid_manager_id: Optional[int] = None
    presales_comments: Optional[str] = None
    sales_comments: Optional[str] = None
    bid_comments: Optional[str] = None
    finance_comments: Optional[str] = None
    rfp_issue_date: Optional[date] = None
    questions_deadline: Optional[datetime] = None
    submission_deadline: Optional[datetime] = None
    expected_award_date: Optional[date] = None
    bond_required: bool = False
    manager_id: Optional[int] = None
    expro_required: bool = False

    # Compared on .date() throughout — questions_deadline/submission_deadline
    # are datetimes that may or may not carry a timezone depending on what
    # the client sends, and rfp_issue_date/expected_award_date are plain
    # dates; comparing calendar dates sidesteps naive/aware mismatches and
    # is all a logical-order sanity check needs.
    @validator("questions_deadline")
    def _questions_after_issue(cls, v, values):
        if v and values.get("rfp_issue_date") and v.date() < values["rfp_issue_date"]:
            raise ValueError("questions_deadline cannot be before rfp_issue_date")
        return v

    @validator("submission_deadline")
    def _submission_after_questions(cls, v, values):
        if v and values.get("questions_deadline") and v.date() < values["questions_deadline"].date():
            raise ValueError("submission_deadline cannot be before questions_deadline")
        return v

    @validator("expected_award_date")
    def _award_after_submission(cls, v, values):
        if v and values.get("submission_deadline") and v < values["submission_deadline"].date():
            raise ValueError("expected_award_date cannot be before submission_deadline")
        return v

class ApprovalDecision(BaseModel):
    decision: str
    comments: Optional[str] = None

class WonRecord(BaseModel):
    won_date: date
    order_number: str
    order_summary: Optional[str] = None
    tcv: Optional[float] = None

class LostRecord(BaseModel):
    lost_date: date
    loss_reason: str
    loss_type: str = "COMPETITOR"
    competitor_name: Optional[str] = None
    winner_name: Optional[str] = None
    winner_tcv: Optional[float] = None
    comments: Optional[str] = None

class TeamMemberAdd(BaseModel):
    emp_id: int
    role: str  # SALES, PRESALES, BID_MANAGER, FINANCE
    notes: Optional[str] = None

class FeasibilityUpdate(BaseModel):
    sales_emp_id: Optional[int] = None
    presales_emp_id: Optional[int] = None
    sales_notes: Optional[str] = None
    presales_notes: Optional[str] = None
    feasibility_status: Optional[str] = None
    feasibility_notes: Optional[str] = None

class QuestionCreate(BaseModel):
    question_text: str
    assigned_to: Optional[int] = None
    deadline_dt: Optional[datetime] = None
    priority: str = "NORMAL"

class QuestionAnswer(BaseModel):
    response: str

class RefConfigUpdate(BaseModel):
    use_company_initials: Optional[bool] = None
    use_presales_initials: Optional[bool] = None
    use_am_initials: Optional[bool] = None
    use_cash: Optional[bool] = None
    use_customer_id: Optional[bool] = None
    use_client_initials: Optional[bool] = None
    use_version: Optional[bool] = None
    separator: Optional[str] = None
    company_initials: Optional[str] = None
    cash_label: Optional[str] = None
    version_label: Optional[str] = None
    ref_number_prefix: Optional[str] = None
    require_unique: Optional[bool] = None

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _gen_opp_number(conn) -> str:
    # Globally sequential (not per-tenant) — same documented tradeoff as
    # bid_number in bids.py: still globally unique, just won't restart at
    # 00001 for each new tenant.
    year = datetime.now().year
    count = await fetch_val(conn, "SELECT COUNT(*) FROM opportunities_v2") or 0
    return f"OPP-{year}-{str(count+1).zfill(5)}"

async def _own_opp_or_404(conn, opp_id: int, company_id: int):
    ok = await fetch_val(conn, "SELECT opp_id FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Opportunity not found")

async def _log(conn, opp_id, action, user_id, field=None, old_val=None, new_val=None, comments=None):
    await execute(conn,
        "INSERT INTO opportunity_logs (opp_id, action, field_name, old_value, new_value, performed_by, comments) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        opp_id, action, field, str(old_val) if old_val else None, str(new_val) if new_val else None, user_id, comments)

async def _get_emp_snapshot(conn, emp_id: int, company_id: int) -> dict:
    """Fetch employee profile to snapshot into team/feasibility tables."""
    emp = await fetch_one(conn, """
        SELECT e.emp_id, e.full_name, e.initials, e.job_title, e.sectors_covered,
               e.email, e.employee_type, u.full_name AS user_full_name, u.job_title AS user_title
        FROM employees e LEFT JOIN users u ON e.user_id = u.user_id
        WHERE e.emp_id = $1 AND e.is_active = TRUE AND e.company_id = $2""", emp_id, company_id)
    return dict(emp) if emp else {}

async def _build_customer_ref(conn, opp_id: int, company_id: int, presales_initials: str = None, customer_id: str = None,
                                am_initials: str = None, client_initials: str = None) -> str:
    """Build customer reference from configuration — image shows:
    Company Initials - Pre-Sales Initials - AM Initials - Ref# - Client Initials - Version 1.x
    All optional checkboxes."""
    cfg = await fetch_one(conn, "SELECT * FROM customer_ref_config WHERE company_id=$1", company_id)
    if not cfg:
        return customer_id or ""
    parts = []
    sep = cfg["separator"] or "-"
    if cfg["use_company_initials"] and cfg.get("company_initials"):
        parts.append(cfg["company_initials"])
    if cfg["use_presales_initials"] and presales_initials:
        parts.append(presales_initials)
    if cfg.get("use_am_initials") and am_initials:
        parts.append(am_initials)
    if cfg["use_cash"] and cfg.get("cash_label"):
        parts.append(cfg["cash_label"])
    if cfg["use_customer_id"] and customer_id:
        parts.append(customer_id)
    if cfg.get("use_client_initials") and client_initials:
        parts.append(client_initials)
    if cfg.get("use_version") and cfg.get("version_label"):
        parts.append(cfg["version_label"])
    return sep.join(parts) if parts else (customer_id or "")

async def _update_questions_count(conn, opp_id: int):
    total = await fetch_val(conn, "SELECT COUNT(*) FROM opportunity_questions WHERE opp_id=$1", opp_id) or 0
    open_q = await fetch_val(conn, "SELECT COUNT(*) FROM opportunity_questions WHERE opp_id=$1 AND status IN ('OPEN','OVERDUE')", opp_id) or 0
    await execute(conn, "UPDATE opportunities_v2 SET questions_count=$1, questions_open=$2 WHERE opp_id=$3", total, open_q, opp_id)

# ── List / Create ─────────────────────────────────────────────────────────────

@router.get("")
async def list_opps(
    page: int=Query(1,ge=1), page_size: int=Query(20),
    search: Optional[str]=None, status: Optional[str]=None,
    sales_rep_id: Optional[int]=None, presales_id: Optional[int]=None,
    bid_manager_id: Optional[int]=None, family_id: Optional[int]=None,
    project_size: Optional[str]=None, is_strategic: Optional[bool]=None,
    date_from: Optional[str]=None, date_to: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conds = ["o.is_deleted=FALSE", "o.company_id=$1"]
    args = [company_id]
    if search:
        args.append(f"%{search}%")
        conds.append(f"(o.customer_name ILIKE ${len(args)} OR o.opp_number ILIKE ${len(args)} OR o.rfp_ref ILIKE ${len(args)} OR o.expro_ref ILIKE ${len(args)} OR o.customer_ref ILIKE ${len(args)})")
    if status:
        args.append(status); conds.append(f"o.status=${len(args)}")
    if sales_rep_id:
        args.append(sales_rep_id); conds.append(f"o.sales_rep_id=${len(args)}")
    if presales_id:
        args.append(presales_id); conds.append(f"o.presales_id=${len(args)}")
    if bid_manager_id:
        args.append(bid_manager_id); conds.append(f"o.bid_manager_id=${len(args)}")
    if family_id:
        args.append(family_id); conds.append(f"o.family_id=${len(args)}")
    if project_size:
        args.append(project_size); conds.append(f"o.project_size=${len(args)}")
    if is_strategic is not None:
        args.append(is_strategic); conds.append(f"o.is_strategic=${len(args)}")
    if date_from:
        args.append(date_from); conds.append(f"o.created_at >= ${len(args)}::date")
    if date_to:
        args.append(date_to); conds.append(f"o.created_at <= ${len(args)}::date + INTERVAL '1 day'")
    where = " AND ".join(conds)
    sql = f"""
        SELECT o.*, sf.family_name, sf.family_name_ar,
               st.solution_name, c.symbol, c.currency_code,
               sr.full_name AS sales_rep_name, sr.email AS sales_rep_email,
               ps.full_name AS presales_name, ps.email AS presales_email,
               bm.full_name AS bid_manager_name,
               cr.full_name AS created_by_name,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_to_deadline,
               o.questions_count, o.questions_open
        FROM opportunities_v2 o
        LEFT JOIN solution_families sf ON o.family_id=sf.family_id
        LEFT JOIN solution_types st ON o.solution_id=st.solution_id
        LEFT JOIN currencies c ON o.currency_id=c.currency_id
        LEFT JOIN users sr ON o.sales_rep_id=sr.user_id
        LEFT JOIN users ps ON o.presales_id=ps.user_id
        LEFT JOIN users bm ON o.bid_manager_id=bm.user_id
        LEFT JOIN users cr ON o.created_by=cr.user_id
        WHERE {where} ORDER BY o.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("", status_code=201)
async def create_opp(body: OppCreate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp_number = await _gen_opp_number(conn)
    # Get presales initials for customer ref
    ps_initials = None
    if body.presales_id:
        ps_user = await fetch_one(conn, "SELECT e.initials FROM employees e WHERE e.user_id=$1 AND e.company_id=$2", body.presales_id, company_id)
        if ps_user:
            ps_initials = ps_user["initials"]
    customer_ref = await _build_customer_ref(conn, 0, company_id, ps_initials, body.customer_id)
    # Check uniqueness
    cfg = await fetch_one(conn, "SELECT require_unique FROM customer_ref_config WHERE company_id=$1", company_id)
    if cfg and cfg["require_unique"] and customer_ref:
        existing = await fetch_val(conn, "SELECT COUNT(*) FROM opportunities_v2 WHERE customer_ref=$1 AND company_id=$2", customer_ref, company_id)
        if existing and existing > 0:
            raise HTTPException(status_code=400, detail=f"Customer reference '{customer_ref}' already exists")
    await execute(conn, """
        INSERT INTO opportunities_v2 (
            opp_number, expro_ref, rfp_ref, customer_name, customer_name_ar,
            customer_id, customer_type, is_strategic,
            source_customer_rfp, source_government, source_etimad, source_expro,
            source_forsah, source_wholesales, project_type,
            family_id, solution_id, solution_detail, media_type, sla_type,
            bandwidth_mbps, quantity, contract_duration, coverage_study,
            nrc, mrc, tcv, currency_id, project_size,
            description, sow_detail, location_text, attachment_url, notes,
            sales_rep_id, presales_id, bid_manager_id,
            presales_comments, sales_comments, bid_comments, finance_comments,
            rfp_issue_date, questions_deadline, submission_deadline, expected_award_date,
            source_single, service_type, service_cat_l1, service_cat_l2,
            bond_required, manager_id, expro_required,
            customer_ref, status, phase, created_by, company_id
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
            $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
            $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
            $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,
            'DRAFT','Draft',$54,$55
        )""",
        opp_number, body.expro_ref, body.rfp_ref, body.customer_name, body.customer_name_ar,
        body.customer_id, body.customer_type, body.is_strategic,
        body.source_customer_rfp, body.source_government, body.source_etimad, body.source_expro,
        body.source_forsah, body.source_wholesales, body.project_type,
        body.family_id, body.solution_id, body.solution_detail, body.media_type, body.sla_type,
        body.bandwidth_mbps, body.quantity, body.contract_duration, body.coverage_study,
        body.nrc, body.mrc, body.tcv, body.currency_id, body.project_size,
        body.description, body.sow_detail, body.location_text, body.attachment_url, body.notes,
        body.sales_rep_id, body.presales_id, body.bid_manager_id,
        body.presales_comments, body.sales_comments, body.bid_comments, body.finance_comments,
        body.rfp_issue_date, body.questions_deadline, body.submission_deadline, body.expected_award_date,
        body.source_single, body.service_type, body.service_cat_l1, body.service_cat_l2,
        body.bond_required, body.manager_id, body.expro_required,
        customer_ref, current_user.user_id, company_id)
    opp_id = await fetch_val(conn, "SELECT opp_id FROM opportunities_v2 WHERE opp_number=$1 AND company_id=$2", opp_number, company_id)
    # Create deadline records
    for dtype, dlabel, ddt in [
        ("RFP_ISSUE","RFP Issue Date", body.rfp_issue_date),
        ("QUESTIONS","Questions Deadline", body.questions_deadline),
        ("SUBMISSION","Submission Deadline", body.submission_deadline),
        ("AWARD","Expected Award Date", body.expected_award_date),
    ]:
        if ddt:
            await execute(conn,
                "INSERT INTO opportunity_deadlines (opp_id, deadline_type, deadline_label, deadline_dt, responsible_id) VALUES ($1,$2,$3,$4,$5)",
                opp_id, dtype, dlabel, ddt, body.sales_rep_id)
    # Auto-add team members from people fields
    for user_id, role in [(body.sales_rep_id,"SALES"),(body.presales_id,"PRESALES"),(body.bid_manager_id,"BID_MANAGER")]:
        if user_id:
            emp = await fetch_one(conn, "SELECT * FROM employees WHERE user_id=$1 AND is_active=TRUE AND company_id=$2", user_id, company_id)
            if emp:
                try:
                    await execute(conn,
                        "INSERT INTO opportunity_team (opp_id, emp_id, role, full_name, initials, job_title, sectors, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                        opp_id, emp["emp_id"], role, emp["full_name"], emp["initials"], emp["job_title"], emp["sectors_covered"], current_user.user_id)
                except Exception:
                    pass
    # Init feasibility if sales+presales provided
    if body.sales_rep_id or body.presales_id:
        sales_emp = await fetch_one(conn, "SELECT * FROM employees WHERE user_id=$1 AND company_id=$2", body.sales_rep_id, company_id) if body.sales_rep_id else None
        ps_emp = await fetch_one(conn, "SELECT * FROM employees WHERE user_id=$1 AND company_id=$2", body.presales_id, company_id) if body.presales_id else None
        try:
            await execute(conn, """
                INSERT INTO expro_feasibility (opp_id, sales_emp_id, sales_name, sales_initials, sales_title, sales_sectors,
                    presales_emp_id, presales_name, presales_initials, presales_title, presales_sectors)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (opp_id) DO NOTHING""",
                opp_id,
                sales_emp["emp_id"] if sales_emp else None,
                sales_emp["full_name"] if sales_emp else None,
                sales_emp["initials"] if sales_emp else None,
                sales_emp["job_title"] if sales_emp else None,
                sales_emp["sectors_covered"] if sales_emp else None,
                ps_emp["emp_id"] if ps_emp else None,
                ps_emp["full_name"] if ps_emp else None,
                ps_emp["initials"] if ps_emp else None,
                ps_emp["job_title"] if ps_emp else None,
                ps_emp["sectors_covered"] if ps_emp else None)
        except Exception:
            pass
    await _log(conn, opp_id, "CREATED", current_user.user_id, comments=f"Opportunity {opp_number} created. Customer ref: {customer_ref}")
    return {"opp_id": opp_id, "opp_number": opp_number, "customer_ref": customer_ref, "message": "Opportunity created"}

# ── Stats / Dashboard ─────────────────────────────────────────────────────────

@router.get("/stats/dashboard")
async def dashboard_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    stats = await fetch_one(conn, """
        SELECT COUNT(*) AS total,
            COUNT(CASE WHEN status='DRAFT' THEN 1 END) AS draft,
            COUNT(CASE WHEN status LIKE 'PENDING%' THEN 1 END) AS pending_approval,
            COUNT(CASE WHEN status='APPROVED' THEN 1 END) AS approved,
            COUNT(CASE WHEN status='SUBMITTED_CUST' THEN 1 END) AS submitted,
            COUNT(CASE WHEN status='WON' THEN 1 END) AS won,
            COUNT(CASE WHEN status='LOST' THEN 1 END) AS lost,
            COUNT(CASE WHEN status IN ('DROPPED','CANCELLED') THEN 1 END) AS dropped,
            COUNT(CASE WHEN submission_deadline BETWEEN NOW() AND NOW()+INTERVAL '7 days' THEN 1 END) AS deadline_7d,
            COUNT(CASE WHEN questions_deadline BETWEEN NOW() AND NOW()+INTERVAL '7 days' THEN 1 END) AS q_deadline_7d,
            COUNT(CASE WHEN submission_deadline < NOW() AND status NOT IN ('WON','LOST','DROPPED','CANCELLED') THEN 1 END) AS overdue,
            COALESCE(SUM(CASE WHEN status='WON' THEN tcv ELSE 0 END),0) AS total_tcv_won,
            COALESCE(SUM(tcv),0) AS total_tcv_pipeline,
            ROUND(100.0*COUNT(CASE WHEN status='WON' THEN 1 END)/NULLIF(COUNT(CASE WHEN status IN ('WON','LOST') THEN 1 END),0),1) AS win_rate,
            SUM(questions_open) AS total_open_questions
        FROM opportunities_v2 WHERE is_deleted=FALSE AND company_id=$1""", company_id)
    by_family = await fetch_all(conn, """
        SELECT sf.family_name, COUNT(*) AS count, COALESCE(SUM(o.tcv),0) AS tcv
        FROM opportunities_v2 o JOIN solution_families sf ON o.family_id=sf.family_id
        WHERE o.is_deleted=FALSE AND o.company_id=$1 GROUP BY sf.family_name ORDER BY count DESC""", company_id)
    by_status = await fetch_all(conn, """
        SELECT status, COUNT(*) AS count FROM opportunities_v2
        WHERE is_deleted=FALSE AND company_id=$1 GROUP BY status ORDER BY count DESC""", company_id)
    return {"stats": stats, "by_family": by_family, "by_status": by_status}

# ── Get single opportunity ────────────────────────────────────────────────────

@router.get("/{opp_id}")
async def get_opp(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp = await fetch_one(conn, """
        SELECT o.*, sf.family_name, sf.family_name_ar,
               st.solution_name, c.symbol, c.currency_code,
               sr.full_name AS sales_rep_name, sr.email AS sales_rep_email,
               ps.full_name AS presales_name, ps.email AS presales_email,
               bm.full_name AS bid_manager_name, bm.email AS bid_manager_email,
               cr.full_name AS created_by_name
        FROM opportunities_v2 o
        LEFT JOIN solution_families sf ON o.family_id=sf.family_id
        LEFT JOIN solution_types st ON o.solution_id=st.solution_id
        LEFT JOIN currencies c ON o.currency_id=c.currency_id
        LEFT JOIN users sr ON o.sales_rep_id=sr.user_id
        LEFT JOIN users ps ON o.presales_id=ps.user_id
        LEFT JOIN users bm ON o.bid_manager_id=bm.user_id
        LEFT JOIN users cr ON o.created_by=cr.user_id
        WHERE o.opp_id=$1 AND o.is_deleted=FALSE AND o.company_id=$2""", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    approvals = await fetch_all(conn, "SELECT * FROM opportunity_approvals WHERE opp_id=$1 ORDER BY approval_level", opp_id)
    deadlines = await fetch_all(conn, "SELECT od.*, u.full_name AS responsible_name FROM opportunity_deadlines od LEFT JOIN users u ON od.responsible_id=u.user_id WHERE od.opp_id=$1 ORDER BY od.deadline_dt", opp_id)
    team = await fetch_all(conn, """
        SELECT ot.*, e.email AS emp_email, e.employee_type, e.tech_specialty
        FROM opportunity_team ot
        LEFT JOIN employees e ON ot.emp_id=e.emp_id
        WHERE ot.opp_id=$1 ORDER BY ot.role, ot.full_name""", opp_id)
    feasibility = await fetch_one(conn, "SELECT * FROM expro_feasibility WHERE opp_id=$1", opp_id)
    questions = await fetch_all(conn, """
        SELECT oq.*, u.full_name AS assigned_to_name, r.full_name AS responded_by_name,
               EXTRACT(DAY FROM oq.deadline_dt - NOW())::INT AS days_left
        FROM opportunity_questions oq
        LEFT JOIN users u ON oq.assigned_to=u.user_id
        LEFT JOIN users r ON oq.responded_by=r.user_id
        WHERE oq.opp_id=$1 ORDER BY oq.created_at DESC""", opp_id)
    logs = await fetch_all(conn, """
        SELECT ol.*, u.full_name AS performed_by_name FROM opportunity_logs ol
        LEFT JOIN users u ON ol.performed_by=u.user_id
        WHERE ol.opp_id=$1 ORDER BY ol.performed_at DESC LIMIT 50""", opp_id)
    return {
        "opportunity": opp,
        "approvals": approvals,
        "deadlines": deadlines,
        "team": team,
        "feasibility": feasibility,
        "questions": questions,
        "logs": logs
    }

# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{opp_id}")
async def update_opp(opp_id: int, body: dict, conn=Depends(get_db), current_user=Depends(get_current_user)):
    allowed = ["customer_name","customer_name_ar","customer_id","customer_type","is_strategic",
               "source_customer_rfp","source_government","source_etimad","source_expro","source_forsah","source_wholesales","project_type",
               "source_single","service_type","service_cat_l1","service_cat_l2",
               "expro_ref","rfp_ref","family_id","solution_id","solution_detail",
               "media_type","sla_type","bandwidth_mbps","quantity","contract_duration","coverage_study",
               "nrc","mrc","tcv","currency_id","project_size",
               "description","sow_detail","location_text","attachment_url","notes",
               "sales_rep_id","presales_id","bid_manager_id",
               "rfp_issue_date","questions_deadline","submission_deadline","expected_award_date","bond_required","manager_id","bond_reminder_sent","expro_required",
               "presales_comments","sales_comments","bid_comments","finance_comments","phase"]
    company_id = require_company(current_user)
    updates = ["updated_at=NOW()", f"updated_by={current_user.user_id}"]
    args = []
    old = await fetch_one(conn, "SELECT * FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not old: raise HTTPException(status_code=404, detail="Opportunity not found")
    for k, v in body.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
            if str(old.get(k)) != str(v):
                await _log(conn, opp_id, "UPDATED", current_user.user_id, k, old.get(k), v)
    if not args: raise HTTPException(status_code=400, detail="No valid fields")
    # Regenerate customer ref if relevant fields changed
    if "customer_id" in body or "presales_id" in body:
        new_cust_id = body.get("customer_id") or old.get("customer_id")
        new_ps_id = body.get("presales_id") or old.get("presales_id")
        ps_initials = None
        if new_ps_id:
            ps_emp = await fetch_one(conn, "SELECT initials FROM employees WHERE user_id=$1 AND company_id=$2", new_ps_id, company_id)
            if ps_emp: ps_initials = ps_emp["initials"]
        new_ref = await _build_customer_ref(conn, opp_id, company_id, ps_initials, new_cust_id)
        args.append(new_ref); updates.append(f"customer_ref=${len(args)}")
    args.append(opp_id); args.append(company_id)
    await execute(conn, f"UPDATE opportunities_v2 SET {','.join(updates)} WHERE opp_id=${len(args)-1} AND company_id=${len(args)}", *args)
    return {"message": "Updated"}

# ── Workflow Actions ──────────────────────────────────────────────────────────

@router.post("/{opp_id}/submit")
async def submit_opp(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp = await fetch_one(conn, "SELECT * FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    if opp["status"] != "DRAFT": raise HTTPException(status_code=400, detail="Only DRAFT opportunities can be submitted")
    await execute(conn, "INSERT INTO opportunity_approvals (opp_id, approval_level, status) VALUES ($1, 1, 'PENDING')", opp_id)
    await execute(conn, "UPDATE opportunities_v2 SET status='PENDING_L1', updated_at=NOW() WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    await _log(conn, opp_id, "SUBMITTED", current_user.user_id, comments="Submitted for Level 1 approval")
    return {"message": "Submitted for approval"}

@router.post("/{opp_id}/approve/{level}")
async def approve_opp(opp_id: int, level: int, body: ApprovalDecision, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","DEPT_MANAGER","DIRECTOR"))):
    company_id = require_company(current_user)
    if level not in [1, 2, 3]: raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")
    opp = await fetch_one(conn, "SELECT * FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    if opp["status"] != f"PENDING_L{level}":
        raise HTTPException(status_code=400, detail=f"Opportunity is not in PENDING_L{level} status")
    # Maker-checker: the person who created the opportunity should not also
    # approve it. ADMIN is exempted as a deliberate override (small teams
    # without a separate approver) but the override is audit-logged.
    self_approval = opp.get("created_by") == current_user.user_id
    if self_approval and "ADMIN" not in current_user.roles:
        raise HTTPException(status_code=403,
            detail="Maker-checker violation: you created this opportunity and cannot also approve it. "
                   "Ask another approver to review it.")
    await execute(conn,
        "UPDATE opportunity_approvals SET status=$1, approver_id=$2, approver_name=$3, approver_position=$4, comments=$5, decided_at=NOW(), is_locked=TRUE WHERE opp_id=$6 AND approval_level=$7",
        body.decision, current_user.user_id, current_user.full_name, ", ".join(current_user.roles), body.comments, opp_id, level)
    if body.decision == "APPROVE":
        if level < 3:
            next_status = f"PENDING_L{level+1}"
            await execute(conn, "INSERT INTO opportunity_approvals (opp_id, approval_level, status) VALUES ($1,$2,'PENDING')", opp_id, level+1)
        else:
            next_status = "APPROVED"
    elif body.decision == "REJECT":
        next_status = "DRAFT"
    else:
        next_status = "CHANGES_REQUESTED"
    await execute(conn, "UPDATE opportunities_v2 SET status=$1, updated_at=NOW() WHERE opp_id=$2 AND company_id=$3", next_status, opp_id, company_id)
    log_comments = body.comments
    if self_approval:
        log_comments = f"[SELF-APPROVAL OVERRIDE by ADMIN] {body.comments or ''}".strip()
    await _log(conn, opp_id, f"LEVEL_{level}_{body.decision}", current_user.user_id, comments=log_comments)
    return {"message": f"Level {level} decision: {body.decision}", "new_status": next_status}

@router.post("/{opp_id}/won")
async def mark_won(opp_id: int, body: WonRecord, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp = await fetch_one(conn, "SELECT expro_required FROM opportunities_v2 WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    if opp["expro_required"]:
        expro_approved = await fetch_val(conn, """
            SELECT COUNT(*) FROM expro_logs el
            JOIN bids b ON el.bid_id=b.bid_id
            WHERE b.opp_id=$1 AND el.status='APPROVED' AND el.company_id=$2""", opp_id, company_id)
        if not expro_approved:
            raise HTTPException(status_code=400,
                detail="This opportunity requires EXPRO/authority approval before it can be marked WON, "
                       "and no approved EXPRO log was found for it. Submit and get an EXPRO log approved first, "
                       "or clear the 'EXPRO required' flag if it no longer applies.")
    await execute(conn,
        "UPDATE opportunities_v2 SET status='WON', phase='Won', won_date=$1, order_number=$2, order_summary=$3, tcv=COALESCE($4,tcv), updated_at=NOW() WHERE opp_id=$5 AND company_id=$6",
        body.won_date, body.order_number, body.order_summary, body.tcv, opp_id, company_id)
    await _log(conn, opp_id, "MARKED_WON", current_user.user_id, comments=f"Order: {body.order_number}")
    return {"message": "Marked WON"}

@router.post("/{opp_id}/lost")
async def mark_lost(opp_id: int, body: LostRecord, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn,
        "UPDATE opportunities_v2 SET status='LOST', phase='Dropped', lost_date=$1, loss_reason=$2, loss_type=$3, competitor_name=$4, winner_name=$5, winner_tcv=$6, updated_at=NOW() WHERE opp_id=$7 AND company_id=$8",
        body.lost_date, body.loss_reason, body.loss_type, body.competitor_name, body.winner_name, body.winner_tcv, opp_id, company_id)
    await _log(conn, opp_id, "MARKED_LOST", current_user.user_id, comments=body.comments or body.loss_reason)
    return {"message": "Marked LOST"}

# ── AI Bid/No-Bid Advisor ────────────────────────────────────────────────────

@router.get("/{opp_id}/ai-recommendation")
async def get_ai_recommendation(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Latest stored AI recommendation for this opportunity, if one has been generated."""
    from app.services import ai_advisor
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    latest = await fetch_one(conn, """
        SELECT ai.*, u.full_name AS generated_by_name FROM opp_ai_insights ai
        LEFT JOIN users u ON ai.generated_by=u.user_id
        WHERE ai.opp_id=$1 ORDER BY ai.created_at DESC LIMIT 1""", opp_id)
    return {"available": ai_advisor.is_configured(), "latest": latest}

@router.post("/{opp_id}/ai-recommendation")
async def generate_ai_recommendation(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Generates a fresh AI bid/no-bid recommendation and stores it (does not overwrite prior runs)."""
    from app.services import ai_advisor
    company_id = require_company(current_user)
    if not ai_advisor.is_configured():
        raise HTTPException(status_code=503,
            detail="AI advisor is not configured on this server. Set ANTHROPIC_API_KEY in the backend environment to enable it.")
    opp = await fetch_one(conn, "SELECT * FROM opportunities_v2 WHERE opp_id=$1 AND is_deleted=FALSE AND company_id=$2", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")

    customer_stats = await fetch_one(conn, """
        SELECT COUNT(*) FILTER (WHERE status='WON') AS won, COUNT(*) FILTER (WHERE status IN ('WON','LOST')) AS total
        FROM opportunities_v2 WHERE customer_name=$1 AND opp_id != $2 AND is_deleted=FALSE AND company_id=$3""",
        opp["customer_name"], opp_id, company_id)
    service_stats = await fetch_one(conn, """
        SELECT COUNT(*) FILTER (WHERE status='WON') AS won, COUNT(*) FILTER (WHERE status IN ('WON','LOST')) AS total
        FROM opportunities_v2 WHERE service_type=$1 AND opp_id != $2 AND is_deleted=FALSE AND company_id=$3""",
        opp["service_type"], opp_id, company_id) if opp["service_type"] else {"won": 0, "total": 0}
    history = {
        "customer_won": customer_stats["won"] or 0, "customer_total": customer_stats["total"] or 0,
        "service_won": service_stats["won"] or 0, "service_total": service_stats["total"] or 0,
    }

    try:
        result = await ai_advisor.generate_recommendation(dict(opp), history)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI advisor call failed: {e}")

    from app.core.config import settings
    row = await fetch_one(conn, """
        INSERT INTO opp_ai_insights (opp_id, recommendation, confidence, key_strengths, key_risks, reasoning, model_used, generated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
        opp_id, result["recommendation"], result["confidence"],
        json.dumps(result["key_strengths"]), json.dumps(result["key_risks"]),
        result["reasoning"], settings.ANTHROPIC_MODEL, current_user.user_id)
    await _log(conn, opp_id, "AI_RECOMMENDATION_GENERATED", current_user.user_id,
        comments=f"{result['recommendation']} ({result['confidence']}% confidence)")
    return {"available": True, "latest": row}

# ── Team Members ──────────────────────────────────────────────────────────────

@router.get("/{opp_id}/team")
async def get_team(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    return await fetch_all(conn, """
        SELECT ot.*, e.email AS emp_email, e.employee_type, e.tech_specialty, e.employee_code
        FROM opportunity_team ot
        LEFT JOIN employees e ON ot.emp_id=e.emp_id
        WHERE ot.opp_id=$1 ORDER BY ot.role, ot.full_name""", opp_id)

@router.post("/{opp_id}/team")
async def add_team_member(opp_id: int, body: TeamMemberAdd, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    emp = await _get_emp_snapshot(conn, body.emp_id, company_id)
    if not emp: raise HTTPException(status_code=404, detail="Employee not found")
    try:
        await execute(conn,
            "INSERT INTO opportunity_team (opp_id, emp_id, role, full_name, initials, job_title, sectors, notes, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            opp_id, body.emp_id, body.role,
            emp.get("full_name") or emp.get("user_full_name"),
            emp.get("initials"),
            emp.get("job_title") or emp.get("user_title"),
            emp.get("sectors_covered"),
            body.notes, current_user.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="This employee already has this role on the opportunity")
    await _log(conn, opp_id, "TEAM_ADDED", current_user.user_id, comments=f"{emp.get('full_name')} as {body.role}")
    return {"message": "Team member added"}

@router.delete("/{opp_id}/team/{team_id}")
async def remove_team_member(opp_id: int, team_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn, "DELETE FROM opportunity_team WHERE team_id=$1 AND opp_id=$2", team_id, opp_id)
    return {"message": "Removed"}

# ── EXPRO Feasibility ─────────────────────────────────────────────────────────

@router.get("/{opp_id}/feasibility")
async def get_feasibility(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    return await fetch_one(conn, "SELECT * FROM expro_feasibility WHERE opp_id=$1", opp_id)

@router.put("/{opp_id}/feasibility")
async def upsert_feasibility(opp_id: int, body: FeasibilityUpdate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    # Fetch employee snapshots
    s_emp = await _get_emp_snapshot(conn, body.sales_emp_id, company_id) if body.sales_emp_id else {}
    p_emp = await _get_emp_snapshot(conn, body.presales_emp_id, company_id) if body.presales_emp_id else {}
    await execute(conn, """
        INSERT INTO expro_feasibility (
            opp_id, sales_emp_id, sales_name, sales_initials, sales_title, sales_sectors, sales_notes,
            presales_emp_id, presales_name, presales_initials, presales_title, presales_sectors, presales_notes,
            feasibility_status, feasibility_notes, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT (opp_id) DO UPDATE SET
            sales_emp_id=EXCLUDED.sales_emp_id, sales_name=EXCLUDED.sales_name,
            sales_initials=EXCLUDED.sales_initials, sales_title=EXCLUDED.sales_title,
            sales_sectors=EXCLUDED.sales_sectors, sales_notes=EXCLUDED.sales_notes,
            presales_emp_id=EXCLUDED.presales_emp_id, presales_name=EXCLUDED.presales_name,
            presales_initials=EXCLUDED.presales_initials, presales_title=EXCLUDED.presales_title,
            presales_sectors=EXCLUDED.presales_sectors, presales_notes=EXCLUDED.presales_notes,
            feasibility_status=EXCLUDED.feasibility_status, feasibility_notes=EXCLUDED.feasibility_notes,
            updated_at=NOW()""",
        opp_id,
        body.sales_emp_id, s_emp.get("full_name"), s_emp.get("initials"), s_emp.get("job_title"), s_emp.get("sectors_covered"), body.sales_notes,
        body.presales_emp_id, p_emp.get("full_name"), p_emp.get("initials"), p_emp.get("job_title"), p_emp.get("sectors_covered"), body.presales_notes,
        body.feasibility_status or "PENDING", body.feasibility_notes)
    await _log(conn, opp_id, "FEASIBILITY_UPDATED", current_user.user_id)
    return {"message": "Feasibility updated"}

# ── Questions ─────────────────────────────────────────────────────────────────

@router.get("/{opp_id}/questions")
async def list_questions(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    # Auto-mark overdue
    await execute(conn, """
        UPDATE opportunity_questions SET status='OVERDUE', updated_at=NOW()
        WHERE opp_id=$1 AND status='OPEN' AND deadline_dt IS NOT NULL AND deadline_dt < NOW()""", opp_id)
    return await fetch_all(conn, """
        SELECT oq.*, u.full_name AS assigned_to_name, u.email AS assigned_to_email,
               r.full_name AS responded_by_name,
               EXTRACT(DAY FROM oq.deadline_dt - NOW())::INT AS days_left
        FROM opportunity_questions oq
        LEFT JOIN users u ON oq.assigned_to=u.user_id
        LEFT JOIN users r ON oq.responded_by=r.user_id
        WHERE oq.opp_id=$1 ORDER BY
            CASE oq.status WHEN 'OVERDUE' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,
            oq.deadline_dt NULLS LAST""", opp_id)

@router.post("/{opp_id}/questions", status_code=201)
async def add_question(opp_id: int, body: QuestionCreate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn,
        "INSERT INTO opportunity_questions (opp_id, question_text, assigned_to, deadline_dt, priority, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
        opp_id, body.question_text, body.assigned_to, body.deadline_dt, body.priority, current_user.user_id)
    await _update_questions_count(conn, opp_id)
    await _log(conn, opp_id, "QUESTION_ADDED", current_user.user_id, comments=body.question_text[:80])
    return {"message": "Question added"}

@router.patch("/{opp_id}/questions/{question_id}/answer")
async def answer_question(opp_id: int, question_id: int, body: QuestionAnswer, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn,
        "UPDATE opportunity_questions SET response=$1, status='ANSWERED', responded_at=NOW(), responded_by=$2, updated_at=NOW() WHERE question_id=$3 AND opp_id=$4",
        body.response, current_user.user_id, question_id, opp_id)
    await _update_questions_count(conn, opp_id)
    return {"message": "Question answered"}

@router.patch("/{opp_id}/questions/{question_id}/close")
async def close_question(opp_id: int, question_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn, "UPDATE opportunity_questions SET status='CLOSED', updated_at=NOW() WHERE question_id=$1 AND opp_id=$2", question_id, opp_id)
    await _update_questions_count(conn, opp_id)
    return {"message": "Question closed"}

@router.delete("/{opp_id}/questions/{question_id}")
async def delete_question(opp_id: int, question_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn, "DELETE FROM opportunity_questions WHERE question_id=$1 AND opp_id=$2", question_id, opp_id)
    await _update_questions_count(conn, opp_id)
    return {"message": "Deleted"}

# ── Customer Reference Config ─────────────────────────────────────────────────

@router.get("/config/customer-ref")
async def get_ref_config(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    cfg = await fetch_one(conn, "SELECT * FROM customer_ref_config WHERE company_id=$1", company_id)
    if not cfg:
        return {"use_company_initials":False,"use_presales_initials":True,"use_cash":False,"use_customer_id":True,"separator":"-","company_initials":"SLM","cash_label":"CASH","require_unique":True}
    return cfg

@router.put("/config/customer-ref")
async def update_ref_config(body: RefConfigUpdate, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    existing = await fetch_one(conn, "SELECT config_id FROM customer_ref_config WHERE company_id=$1", company_id)
    if not existing:
        await execute(conn, "INSERT INTO customer_ref_config (company_id) VALUES ($1)", company_id)
    allowed = ["use_company_initials","use_presales_initials","use_am_initials","use_cash","use_customer_id","use_client_initials","use_version","separator","company_initials","cash_label","version_label","ref_number_prefix","require_unique"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if args:
        args.append(company_id)
        await execute(conn, f"UPDATE customer_ref_config SET {','.join(updates)} WHERE company_id=${len(args)}", *args)
    return {"message": "Config updated"}

@router.post("/config/customer-ref/preview")
async def preview_ref(body: dict, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Preview what a customer reference would look like with given config + example data."""
    cfg = body.get("config", {})
    example_ps_initials = body.get("presales_initials", "SA")
    example_customer_id = body.get("customer_id", "12345")
    sep = cfg.get("separator", "-")
    parts = []
    if cfg.get("use_company_initials") and cfg.get("company_initials"):
        parts.append(cfg["company_initials"])
    if cfg.get("use_presales_initials"):
        parts.append(example_ps_initials)
    if cfg.get("use_cash") and cfg.get("cash_label"):
        parts.append(cfg["cash_label"])
    if cfg.get("use_customer_id"):
        parts.append(example_customer_id)
    return {"preview": sep.join(parts) if parts else example_customer_id}

# ── Employees for selection ───────────────────────────────────────────────────

@router.get("/employees/for-selection")
async def employees_for_selection(
    role: Optional[str]=None,
    search: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Returns employees formatted for dropdown selection with full name, initials, title, sectors."""
    company_id = require_company(current_user)
    conds = ["e.is_active=TRUE", "e.company_id=$1"]
    args = [company_id]
    if role:
        args.append(role); conds.append(f"e.employee_type=${len(args)}")
    if search:
        args.append(f"%{search}%"); conds.append(f"(e.full_name ILIKE ${len(args)} OR e.job_title ILIKE ${len(args)})")
    where = " AND ".join(conds)
    return await fetch_all(conn, f"""
        SELECT e.emp_id, e.user_id, e.full_name, e.initials, e.job_title,
               e.employee_type, e.sectors_covered, e.email, e.employee_code,
               u.full_name AS user_full_name, u.job_title AS user_job_title
        FROM employees e
        LEFT JOIN users u ON e.user_id=u.user_id
        WHERE {where} ORDER BY e.full_name""", *args)


@router.post("/{opp_id}/trigger-bond-reminder")
async def trigger_bond_reminder(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """
    Manually trigger bond reminder for a specific opportunity.
    Also called automatically when bond_required is set and deadline is within 6 days.
    """
    from app.services.email_service import send_bond_reminder
    company_id = require_company(current_user)
    opp = await fetch_one(conn, """
        SELECT o.*, bp.user_id AS bid_person_id, bp.full_name AS bid_person_name, bp.email AS bid_person_email,
               mgr.user_id AS manager_user_id, mgr.full_name AS manager_name, mgr.email AS manager_email,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_left
        FROM opportunities_v2 o
        LEFT JOIN users bp ON o.bid_manager_id = bp.user_id
        LEFT JOIN users mgr ON o.manager_id = mgr.user_id
        WHERE o.opp_id=$1 AND o.company_id=$2""", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    if not opp.get("bond_required"):
        raise HTTPException(status_code=400, detail="Bond not required for this opportunity")

    days_left = opp.get("days_left") or 0
    deadline_str = opp["submission_deadline"].strftime("%d %B %Y %H:%M") if opp.get("submission_deadline") else "N/A"
    sent_to = []

    if opp.get("bid_person_email"):
        ok = await send_bond_reminder(opp["bid_person_email"], opp["bid_person_name"],
            opp["opp_number"], opp["customer_name"], deadline_str, int(days_left), "BID_PERSON")
        if ok:
            sent_to.append(opp["bid_person_name"])
            await execute(conn,
                "INSERT INTO notifications (user_id, notif_type, title, body, company_id) VALUES ($1,'BOND_REMINDER',$2,$3,$4)",
                opp["bid_person_id"],
                f"⚠️ Bond Required: {opp['opp_number']}",
                f"Please request the bid bond for {opp['customer_name']}. Deadline in {int(days_left)} day(s).",
                company_id)

    if opp.get("manager_email") and opp.get("manager_user_id") != opp.get("bid_person_id"):
        ok = await send_bond_reminder(opp["manager_email"], opp["manager_name"],
            opp["opp_number"], opp["customer_name"], deadline_str, int(days_left), "MANAGER")
        if ok:
            sent_to.append(f"{opp['manager_name']} (Manager)")
            await execute(conn,
                "INSERT INTO notifications (user_id, notif_type, title, body, company_id) VALUES ($1,'BOND_REMINDER_MGR',$2,$3,$4)",
                opp["manager_user_id"],
                f"⚠️ [Manager] Bond Required: {opp['opp_number']}",
                f"Bond reminder for {opp['customer_name']} — {int(days_left)} day(s) to deadline.",
                company_id)

    await execute(conn,
        "UPDATE opportunities_v2 SET bond_reminder_sent=TRUE, bond_reminder_sent_at=NOW() WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    await _log(conn, opp_id, "BOND_REMINDER_SENT", current_user.user_id, comments=f"Sent to: {', '.join(sent_to)}")
    return {"message": f"Bond reminder sent to: {', '.join(sent_to) if sent_to else 'no recipients configured'}"}

# ── Solution lookups ──────────────────────────────────────────────────────────

@router.get("/solutions/families")
async def get_families(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, "SELECT * FROM solution_families WHERE is_active=TRUE AND company_id=$1 ORDER BY sort_order", company_id)

@router.get("/solutions/types")
async def get_types(family_id: Optional[int]=None, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    if family_id:
        return await fetch_all(conn, "SELECT * FROM solution_types WHERE family_id=$1 AND is_active=TRUE AND company_id=$2 ORDER BY sort_order", family_id, company_id)
    return await fetch_all(conn, "SELECT st.*, sf.family_name FROM solution_types st JOIN solution_families sf ON st.family_id=sf.family_id WHERE st.is_active=TRUE AND st.company_id=$1 ORDER BY sf.sort_order, st.sort_order", company_id)

# ── Deadlines ─────────────────────────────────────────────────────────────────

@router.get("/deadlines/upcoming")
async def upcoming_deadlines(days: int=Query(7), conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT od.*, o.opp_number, o.customer_name, o.status,
               u.full_name AS responsible_name, u.email AS responsible_email,
               EXTRACT(DAY FROM od.deadline_dt - NOW())::INT AS days_left
        FROM opportunity_deadlines od
        JOIN opportunities_v2 o ON od.opp_id=o.opp_id
        LEFT JOIN users u ON od.responsible_id=u.user_id
        WHERE od.deadline_dt BETWEEN NOW() AND NOW()+($1||' days')::INTERVAL
          AND o.is_deleted=FALSE AND od.status='PENDING' AND o.company_id=$2
        ORDER BY od.deadline_dt""", str(days), company_id)

@router.get("/deadlines/overdue")
async def overdue_deadlines(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT od.*, o.opp_number, o.customer_name, o.status,
               EXTRACT(DAY FROM NOW()-od.deadline_dt)::INT AS days_overdue
        FROM opportunity_deadlines od
        JOIN opportunities_v2 o ON od.opp_id=o.opp_id
        WHERE od.deadline_dt < NOW() AND od.status='PENDING'
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
          AND o.is_deleted=FALSE AND o.company_id=$1
        ORDER BY od.deadline_dt""", company_id)
