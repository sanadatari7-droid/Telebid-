from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import os, uuid, aiofiles

router = APIRouter(prefix="/bids", tags=["Bids"])

# Allowed forward/lateral transitions per status_code. Any status can move to
# CANCELLED (except the two terminal ones). Missing a mapping here previously
# let PATCH /{bid_id}/status set ANY status_id from ANY status with no check,
# so a bid could jump DRAFT->AWARDED or bounce back out of a terminal state.
BID_STATUS_TRANSITIONS = {
    "DRAFT":             ["PENDING_APPROVAL", "CANCELLED"],
    "PENDING_APPROVAL":  ["APPROVED", "DRAFT", "CANCELLED"],
    "APPROVED":          ["PUBLISHED", "CANCELLED"],
    "PUBLISHED":         ["OPEN", "CANCELLED"],
    "OPEN":              ["CLOSED", "CANCELLED"],
    "CLOSED":            ["TECH_EVAL", "CANCELLED"],
    "TECH_EVAL":         ["FIN_EVAL", "CANCELLED"],
    "FIN_EVAL":          ["AWARDED", "CANCELLED"],
    "AWARDED":           ["ARCHIVED"],
    "CANCELLED":         [],
    "ARCHIVED":          [],
}

class BidCreate(BaseModel):
    bid_title: str
    bid_type_id: int
    bid_source: str
    opp_id: Optional[int] = None
    dept_id: Optional[int] = None
    category_id: Optional[int] = None
    budget: Optional[float] = None
    currency_id: int = 1
    submission_deadline: Optional[datetime] = None
    description: Optional[str] = None

@router.get("/dashboard")
async def dashboard_kpi(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    kpi = await fetch_one(conn, """
        SELECT
            COUNT(*) AS total_bids,
            COUNT(CASE WHEN bs.status_code='DRAFT' THEN 1 END) AS draft_bids,
            COUNT(CASE WHEN bs.status_code='OPEN' THEN 1 END) AS open_bids,
            COUNT(CASE WHEN bs.status_code='AWARDED' THEN 1 END) AS awarded_bids,
            COUNT(CASE WHEN bs.status_code='CANCELLED' THEN 1 END) AS cancelled_bids,
            COUNT(CASE WHEN b.submission_deadline < NOW() AND bs.status_code IN ('OPEN','PUBLISHED') THEN 1 END) AS expired_bids,
            COUNT(CASE WHEN b.submission_deadline BETWEEN NOW() AND NOW()+INTERVAL '7 days' THEN 1 END) AS upcoming_deadlines,
            COALESCE(SUM(b.budget),0) AS total_budget,
            COALESCE(SUM(CASE WHEN bs.status_code='AWARDED' THEN b.budget ELSE 0 END),0) AS budget_used
        FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id
        WHERE b.is_deleted=FALSE AND b.company_id=$1""", company_id)
    monthly = await fetch_all(conn, """
        SELECT TO_CHAR(created_at,'Mon') AS month, TO_CHAR(created_at,'MM') AS month_num,
               COUNT(*) AS total, COALESCE(SUM(budget),0) AS total_budget
        FROM bids WHERE is_deleted=FALSE AND company_id=$1 AND created_at >= NOW()-INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at,'Mon'),TO_CHAR(created_at,'MM')
        ORDER BY month_num""", company_id)
    type_dist = await fetch_all(conn, """
        SELECT bt.type_code, bt.type_name, COUNT(b.bid_id) AS count
        FROM bid_types bt LEFT JOIN bids b ON bt.type_id=b.bid_type_id AND b.is_deleted=FALSE AND b.company_id=$1
        GROUP BY bt.type_code,bt.type_name ORDER BY count DESC""", company_id)
    dept_spend = await fetch_all(conn, """
        SELECT d.dept_name, COALESCE(SUM(b.budget),0) AS total_budget, COUNT(b.bid_id) AS bid_count
        FROM departments d LEFT JOIN bids b ON d.dept_id=b.dept_id AND b.is_deleted=FALSE AND b.company_id=$1
        GROUP BY d.dept_name ORDER BY total_budget DESC LIMIT 5""", company_id)
    recent = await fetch_all(conn, """
        SELECT b.bid_id,b.bid_number,b.bid_title,b.budget,b.submission_deadline,b.created_at,
               bt.type_code AS bid_type_code, bs.status_code, bs.status_name, bs.color_hex,
               c.symbol, d.dept_name,
               CASE WHEN b.submission_deadline > NOW()+INTERVAL '7 days' THEN 'GREEN'
                    WHEN b.submission_deadline > NOW()+INTERVAL '2 days' THEN 'ORANGE'
                    WHEN b.submission_deadline > NOW() THEN 'RED' ELSE 'GRAY' END AS deadline_color,
               EXTRACT(DAY FROM b.submission_deadline-NOW())::INT AS days_remaining
        FROM bids b JOIN bid_types bt ON b.bid_type_id=bt.type_id
        JOIN bid_statuses bs ON b.status_id=bs.status_id
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        LEFT JOIN departments d ON b.dept_id=d.dept_id
        WHERE b.is_deleted=FALSE AND b.company_id=$1 ORDER BY b.created_at DESC LIMIT 10""", company_id)
    return {"kpi":kpi,"monthly_stats":monthly,"type_distribution":type_dist,"dept_spending":dept_spend,"recent_activity":recent}

@router.get("")
async def list_bids(
    page:int=Query(1,ge=1), page_size:int=Query(20,ge=1,le=500),
    search:Optional[str]=None, status_code:Optional[str]=None,
    bid_type:Optional[str]=None, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conditions = ["b.is_deleted=FALSE", "b.company_id=$1"]
    args = [company_id]
    if status_code:
        args.append(status_code); conditions.append(f"bs.status_code=${len(args)}")
    if bid_type:
        args.append(bid_type); conditions.append(f"bt.type_code=${len(args)}")
    if search:
        args.append(f"%{search}%"); conditions.append(f"(b.bid_title ILIKE ${len(args)} OR b.bid_number ILIKE ${len(args)})")
    where = " AND ".join(conditions)
    sql = f"""SELECT b.bid_id,b.bid_number,b.bid_title,b.budget,b.submission_deadline,b.created_at,
                     bt.type_code AS bid_type_code,bt.type_name AS bid_type_name,
                     bs.status_code,bs.status_name,bs.color_hex,c.symbol,c.currency_code,
                     d.dept_name,u.full_name AS created_by_name,
                     CASE WHEN b.submission_deadline>NOW()+INTERVAL '7 days' THEN 'GREEN'
                          WHEN b.submission_deadline>NOW()+INTERVAL '2 days' THEN 'ORANGE'
                          WHEN b.submission_deadline>NOW() THEN 'RED' ELSE 'GRAY' END AS deadline_color,
                     EXTRACT(DAY FROM b.submission_deadline-NOW())::INT AS days_remaining
              FROM bids b JOIN bid_types bt ON b.bid_type_id=bt.type_id
              JOIN bid_statuses bs ON b.status_id=bs.status_id
              LEFT JOIN currencies c ON b.currency_id=c.currency_id
              LEFT JOIN departments d ON b.dept_id=d.dept_id
              LEFT JOIN users u ON b.created_by=u.user_id
              WHERE {where} ORDER BY b.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.post("", status_code=201)
async def create_bid(body:BidCreate, conn=Depends(get_db),
                     current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    draft_status = await fetch_val(conn, "SELECT status_id FROM bid_statuses WHERE status_code='DRAFT'")
    year = datetime.now().year
    # bid_number is globally unique (not per-company) — sequencing counts all
    # tenants' bids, so a new tenant's numbering won't restart at 00001. That's
    # a cosmetic tradeoff, not an isolation issue: making it per-tenant would
    # need the UNIQUE constraint changed to UNIQUE(company_id, bid_number),
    # which is out of scope for this pass.
    count = await fetch_val(conn, "SELECT COUNT(*) FROM bids") or 0
    bid_number = f"BID-{year}-{str(count+1).zfill(5)}"
    # Resolve module_id from module_code if provided
    module_id = None
    if hasattr(body, 'module_code') and body.module_code:
        module_id = await fetch_val(conn, "SELECT module_id FROM bid_modules WHERE module_code=$1", body.module_code)
    await execute(conn,
        """INSERT INTO bids (bid_number,bid_title,description,opp_id,bid_type_id,dept_id,
                             budget,currency_id,bid_source,submission_deadline,
                             customer_name,organization,is_government,
                             location_city,location_country,location_name,estimated_value,
                             module_id,status_id,created_by,qr_code_data,company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)""",
        bid_number, body.bid_title, body.description, body.opp_id, body.bid_type_id,
        body.dept_id, body.budget, body.currency_id, body.bid_source,
        body.submission_deadline,
        getattr(body,'customer_name',None), getattr(body,'organization',None),
        getattr(body,'is_government',False),
        getattr(body,'location_city',None), getattr(body,'location_country',None),
        getattr(body,'location_name',None), getattr(body,'estimated_value',None),
        module_id, draft_status, current_user.user_id, bid_number, company_id)
    await execute(conn,
        "INSERT INTO audit_logs (user_id,username,action,module,company_id) VALUES ($1,$2,'CREATE','BIDS',$3)",
        current_user.user_id, current_user.username, company_id)
    return await fetch_one(conn,
        "SELECT b.*,bs.status_name,bs.color_hex,bt.type_name FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id JOIN bid_types bt ON b.bid_type_id=bt.type_id WHERE b.bid_number=$1 AND b.company_id=$2",
        bid_number, company_id)


@router.get("/calendar")
async def calendar_events(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    bids = await fetch_all(conn,
        """SELECT bid_id,bid_number,bid_title,submission_deadline,opening_date,closing_date,
                  bs.status_code,bs.color_hex
           FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id
           WHERE b.is_deleted=FALSE AND b.company_id=$1 AND (
               b.submission_deadline IS NOT NULL OR
               b.opening_date IS NOT NULL OR
               b.closing_date IS NOT NULL
           ) ORDER BY b.submission_deadline""", company_id)
    contracts = await fetch_all(conn,
        """SELECT c.contract_id,c.contract_number,b.bid_title,c.start_date,c.end_date,c.status
           FROM contracts c JOIN bids b ON c.bid_id=b.bid_id
           WHERE c.is_deleted=FALSE AND c.company_id=$1 AND (c.start_date IS NOT NULL OR c.end_date IS NOT NULL)""", company_id)
    return {"bids": bids, "contracts": contracts}

@router.get("/{bid_id}")
async def get_bid(bid_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    bid = await fetch_one(conn, """
        SELECT b.*,bt.type_code AS bid_type_code,bt.type_name AS bid_type_name,
               bs.status_code,bs.status_name,bs.color_hex,c.symbol,c.currency_code,
               d.dept_name,u.full_name AS created_by_name,
               CASE WHEN b.submission_deadline>NOW()+INTERVAL '7 days' THEN 'GREEN'
                    WHEN b.submission_deadline>NOW()+INTERVAL '2 days' THEN 'ORANGE'
                    WHEN b.submission_deadline>NOW() THEN 'RED' ELSE 'GRAY' END AS deadline_color,
               EXTRACT(DAY FROM b.submission_deadline-NOW())::INT AS days_remaining
        FROM bids b JOIN bid_types bt ON b.bid_type_id=bt.type_id
        JOIN bid_statuses bs ON b.status_id=bs.status_id
        LEFT JOIN currencies c ON b.currency_id=c.currency_id
        LEFT JOIN departments d ON b.dept_id=d.dept_id
        LEFT JOIN users u ON b.created_by=u.user_id
        WHERE b.bid_id=$1 AND b.is_deleted=FALSE AND b.company_id=$2""", bid_id, company_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    return bid

@router.patch("/{bid_id}/status")
async def update_status(bid_id:int, body:dict, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    old = await fetch_one(conn,
        "SELECT b.status_id, bs.status_code FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id WHERE b.bid_id=$1 AND b.company_id=$2",
        bid_id, company_id)
    if not old:
        raise HTTPException(status_code=404, detail="Bid not found")
    new_status = await fetch_one(conn, "SELECT status_id, status_code FROM bid_statuses WHERE status_id=$1", body.get("status_id"))
    if not new_status:
        raise HTTPException(status_code=400, detail="Invalid status_id")
    if new_status["status_code"] != old["status_code"]:
        allowed_next = BID_STATUS_TRANSITIONS.get(old["status_code"], [])
        if new_status["status_code"] not in allowed_next:
            raise HTTPException(status_code=400,
                detail=f"Invalid transition: {old['status_code']} -> {new_status['status_code']}. "
                       f"Allowed next: {', '.join(allowed_next) or 'none (terminal status)'}")
    await execute(conn,
        "UPDATE bids SET status_id=$1,updated_by=$2,updated_at=NOW() WHERE bid_id=$3 AND company_id=$4",
        body["status_id"], current_user.user_id, bid_id, company_id)
    await execute(conn,
        "INSERT INTO audit_logs (user_id,username,action,module,record_id,record_type,old_value,new_value,company_id) VALUES ($1,$2,'STATUS_CHANGE','BIDS',$3,'BID',$4,$5,$6)",
        current_user.user_id, current_user.username, bid_id, old["status_code"], new_status["status_code"], company_id)
    return {"message": "Status updated"}

@router.post("/{bid_id}/approve")
async def approve_bid(bid_id:int, body:dict, conn=Depends(get_db),
                      current_user=Depends(require_roles("DEPT_MANAGER","FINANCE","DIRECTOR","ADMIN"))):
    company_id = require_company(current_user)
    bid = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    await execute(conn,
        "INSERT INTO approvals (bid_id,approval_type,approver_id,approval_level,status,decision,comments,decided_at,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)",
        bid_id, body.get("approval_type","GENERAL"), current_user.user_id,
        body.get("level",1),
        "APPROVED" if body.get("decision")=="APPROVE" else "REJECTED",
        body.get("decision"), body.get("comments"), company_id)
    if body.get("decision") == "APPROVE":
        published = await fetch_val(conn, "SELECT status_id FROM bid_statuses WHERE status_code='PUBLISHED'")
        await execute(conn, "UPDATE bids SET status_id=$1 WHERE bid_id=$2 AND company_id=$3", published, bid_id, company_id)
    return {"message": f"Decision recorded: {body.get('decision')}"}

@router.get("/{bid_id}/approvals")
async def get_approvals(bid_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn,
        "SELECT a.*,u.full_name AS approver_name FROM approvals a JOIN users u ON a.approver_id=u.user_id WHERE a.bid_id=$1 AND a.company_id=$2 ORDER BY a.approval_level",
        bid_id, company_id)

@router.post("/{bid_id}/award")
async def award_bid(bid_id:int, body:dict, conn=Depends(get_db),
                    current_user=Depends(require_roles("ADMIN","DIRECTOR"))):
    company_id = require_company(current_user)
    bid = await fetch_one(conn, "SELECT * FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    vendor_ok = await fetch_val(conn, "SELECT vendor_id FROM vendors WHERE vendor_id=$1 AND company_id=$2", body["vendor_id"], company_id)
    if not vendor_ok:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # contract_number is globally unique — see the note on bid_number in
    # create_bid above; same deliberate tradeoff.
    count = await fetch_val(conn, "SELECT COUNT(*) FROM contracts") or 0
    contract_number = f"CON-{datetime.now().year}-{str(count+1).zfill(5)}"
    await execute(conn,
        "INSERT INTO contracts (contract_number,bid_id,vendor_id,contract_value,currency_id,status,created_by,company_id) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7)",
        contract_number, bid_id, body["vendor_id"], bid.get("budget"), bid.get("currency_id",1), current_user.user_id, company_id)
    awarded = await fetch_val(conn, "SELECT status_id FROM bid_statuses WHERE status_code='AWARDED'")
    await execute(conn, "UPDATE bids SET status_id=$1 WHERE bid_id=$2 AND company_id=$3", awarded, bid_id, company_id)
    contract = await fetch_one(conn, "SELECT * FROM contracts WHERE contract_number=$1 AND company_id=$2", contract_number, company_id)
    return {"message": "Bid awarded", "contract": contract}

async def _own_bid_or_404(conn, bid_id: int, company_id: int):
    ok = await fetch_val(conn, "SELECT bid_id FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Bid not found")

@router.get("/{bid_id}/documents")
async def list_docs(bid_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn,
        "SELECT d.*,u.full_name AS uploaded_by_name FROM documents d JOIN users u ON d.uploaded_by=u.user_id WHERE d.bid_id=$1 AND d.is_deleted=FALSE ORDER BY d.uploaded_at DESC",
        bid_id)

@router.post("/{bid_id}/documents")
async def upload_doc(bid_id:int, doc_type:str="GENERAL", file:UploadFile=File(...),
                     conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    content = await file.read()
    ext = file.filename.rsplit(".",1)[-1].lower() if "." in file.filename else ""
    upload_dir = f"uploads/bids/{bid_id}"
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}_{file.filename}"
    filepath = f"{upload_dir}/{filename}"
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    await execute(conn,
        "INSERT INTO documents (bid_id,doc_type,doc_name,file_path,file_size,file_ext,mime_type,uploaded_by,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        bid_id, doc_type, file.filename, filepath, len(content), ext, file.content_type, current_user.user_id, company_id)
    return {"message": "Uploaded", "filename": file.filename}

@router.post("/{bid_id}/clone")
async def clone_bid(bid_id:int, body:dict, conn=Depends(get_db),
                    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    src = await fetch_one(conn, "SELECT * FROM bids WHERE bid_id=$1 AND company_id=$2", bid_id, company_id)
    if not src:
        raise HTTPException(status_code=404, detail="Bid not found")
    draft_status = await fetch_val(conn, "SELECT status_id FROM bid_statuses WHERE status_code='DRAFT'")
    count = await fetch_val(conn, "SELECT COUNT(*) FROM bids") or 0
    new_num = f"BID-{datetime.now().year}-{str(count+1).zfill(5)}"
    await execute(conn,
        "INSERT INTO bids (bid_number,bid_title,bid_type_id,dept_id,category_id,budget,currency_id,bid_source,status_id,created_by,qr_code_data,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        new_num, body.get("title",f"Copy of {src['bid_title']}"), src["bid_type_id"],
        src["dept_id"], src["category_id"], src["budget"], src["currency_id"],
        src["bid_source"], draft_status, current_user.user_id, new_num, company_id)
    return {"message": "Cloned", "bid_number": new_num}

@router.get("/{bid_id}/vendor-ranking")
async def vendor_ranking(bid_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn, """
        SELECT v.vendor_id, v.company_name AS vendor_name,
               SUM(es.score * ec.weight / 100) AS weighted_score,
               COUNT(es.score_id) AS criteria_count,
               RANK() OVER (ORDER BY SUM(es.score * ec.weight / 100) DESC) AS ranking
        FROM bid_evaluations be
        JOIN evaluation_scores es ON be.bid_eval_id=es.bid_eval_id
        JOIN evaluation_criteria ec ON es.crit_id=ec.crit_id
        JOIN vendors v ON es.vendor_id=v.vendor_id
        WHERE be.bid_id=$1 AND be.status='SUBMITTED'
        GROUP BY v.vendor_id,v.company_name ORDER BY weighted_score DESC""", bid_id)

@router.get("/{bid_id}/invitations")
async def list_invitations(bid_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn,
        """SELECT i.*,v.company_name,v.email AS vendor_email,v.contact_person,
                  u.full_name AS invited_by_name
           FROM invitations i JOIN vendors v ON i.vendor_id=v.vendor_id
           JOIN users u ON i.invited_by=u.user_id
           WHERE i.bid_id=$1 ORDER BY i.date_sent DESC""", bid_id)

@router.patch("/{bid_id}/invitations/{inv_id}/status")
async def update_invitation_status(bid_id: int, inv_id: int, body: dict,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    await execute(conn,
        "UPDATE invitations SET status=$1,date_responded=NOW() WHERE inv_id=$2 AND bid_id=$3 AND company_id=$4",
        body["status"], inv_id, bid_id, company_id)
    return {"message": "Invitation status updated"}


@router.post("/{bid_id}/archive")
async def archive_bid(bid_id: int, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    archived = await fetch_val(conn, "SELECT status_id FROM bid_statuses WHERE status_code='ARCHIVED'")
    await execute(conn,
        "UPDATE bids SET status_id=$1,updated_by=$2,updated_at=NOW() WHERE bid_id=$3 AND company_id=$4",
        archived, current_user.user_id, bid_id, company_id)
    await execute(conn,
        "INSERT INTO audit_logs (user_id,username,action,module,record_id,record_type,company_id) VALUES ($1,$2,'ARCHIVE','BIDS',$3,'BID',$4)",
        current_user.user_id, current_user.username, bid_id, company_id)
    return {"message": "Bid archived"}

@router.get("/{bid_id}/history")
async def bid_history(bid_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_bid_or_404(conn, bid_id, company_id)
    return await fetch_all(conn,
        """SELECT al.log_id,al.action,al.old_value,al.new_value,al.action_at,
                  al.username,u.full_name AS user_name
           FROM audit_logs al LEFT JOIN users u ON al.user_id=u.user_id
           WHERE al.record_id=$1 AND al.module='BIDS' AND al.company_id=$2
           ORDER BY al.action_at DESC""", bid_id, company_id)
