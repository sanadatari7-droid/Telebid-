from fastapi import APIRouter, Depends, HTTPException
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel
from typing import Optional
from datetime import date

router = APIRouter(prefix="/opportunities", tags=["Opportunities"])

class OppCreate(BaseModel):
    title: str
    procurement_type: str
    customer_name: str
    sales_rep_id: int
    dept_id: Optional[int] = None
    company_ref_required: str = "NOT_APPLICABLE"
    company_ref_id: Optional[int] = None
    submission_deadline: Optional[date] = None

async def _own_opp_or_404(conn, opp_id: int, company_id: int):
    ok = await fetch_val(conn, "SELECT opp_id FROM opportunities WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Opportunity not found")

@router.get("")
async def list_opps(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT o.*,
               us.full_name AS sales_rep_name, us.email AS sales_rep_email,
               up.full_name AS presales_name, um.full_name AS manager_name,
               d.dept_name, cr.ref_number AS company_ref_number
        FROM opportunities o
        LEFT JOIN users us ON o.sales_rep_id=us.user_id
        LEFT JOIN users up ON o.presales_eng_id=up.user_id
        LEFT JOIN users um ON o.dept_manager_id=um.user_id
        LEFT JOIN departments d ON o.dept_id=d.dept_id
        LEFT JOIN company_references cr ON o.company_ref_id=cr.ref_id
        WHERE o.is_deleted=FALSE AND o.company_id=$1 ORDER BY o.created_at DESC""", company_id)

@router.post("", status_code=201)
async def create_opp(body:OppCreate, conn=Depends(get_db),
                     current_user=Depends(require_roles("SALES","PROCUREMENT","ADMIN"))):
    company_id = require_company(current_user)
    # opp_number is globally unique across tenants (see the same tradeoff
    # documented in bids.py's create_bid) — cosmetic non-sequential
    # per-tenant numbering, not an isolation issue.
    count = await fetch_val(conn, "SELECT COUNT(*) FROM opportunities") or 0
    opp_number = f"OPP-{__import__('datetime').datetime.now().year}-{str(count+1).zfill(5)}"
    presales = await fetch_one(conn,
        """SELECT e2.user_id AS presales_user_id FROM sales_presales_mapping spm
           JOIN employees e1 ON spm.sales_emp_id=e1.emp_id AND e1.user_id=$1
           JOIN employees e2 ON spm.presales_emp_id=e2.emp_id WHERE spm.is_active=TRUE""",
        body.sales_rep_id)
    dept_manager = await fetch_one(conn,
        "SELECT manager_id FROM departments WHERE dept_id=$1", body.dept_id) if body.dept_id else None
    await execute(conn,
        """INSERT INTO opportunities (opp_number,title,procurement_type,customer_name,dept_id,
               sales_rep_id,presales_eng_id,dept_manager_id,company_ref_required,
               company_ref_id,submission_deadline,status,current_step,created_by,company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT','INITIATION',$12,$13)""",
        opp_number, body.title, body.procurement_type, body.customer_name, body.dept_id,
        body.sales_rep_id, presales["presales_user_id"] if presales else None,
        dept_manager["manager_id"] if dept_manager else None,
        body.company_ref_required, body.company_ref_id, body.submission_deadline, current_user.user_id, company_id)
    return await fetch_one(conn, "SELECT * FROM opportunities WHERE opp_number=$1 AND company_id=$2", opp_number, company_id)

@router.get("/{opp_id}")
async def get_opp(opp_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp = await fetch_one(conn, """
        SELECT o.*,us.full_name AS sales_rep_name,up.full_name AS presales_name,
               um.full_name AS manager_name,d.dept_name
        FROM opportunities o
        LEFT JOIN users us ON o.sales_rep_id=us.user_id
        LEFT JOIN users up ON o.presales_eng_id=up.user_id
        LEFT JOIN users um ON o.dept_manager_id=um.user_id
        LEFT JOIN departments d ON o.dept_id=d.dept_id
        WHERE o.opp_id=$1 AND o.is_deleted=FALSE AND o.company_id=$2""", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp

@router.post("/{opp_id}/submit")
async def submit_opp(opp_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn,
        "UPDATE opportunities SET status='SUBMITTED',current_step='MANAGER_REVIEW',updated_at=NOW() WHERE opp_id=$1 AND company_id=$2",
        opp_id, company_id)
    await execute(conn,
        "INSERT INTO notifications (user_id,notif_type,title,related_opp,company_id) SELECT dept_manager_id,'OPP_SUBMITTED','New opportunity for review',$1,$2 FROM opportunities WHERE opp_id=$1 AND company_id=$2 AND dept_manager_id IS NOT NULL",
        opp_id, company_id)
    return {"message": "Submitted for manager review"}

@router.post("/{opp_id}/manager-decision")
async def manager_decision(opp_id:int, body:dict, conn=Depends(get_db),
                           current_user=Depends(require_roles("DEPT_MANAGER","ADMIN"))):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    decision = body.get("decision")
    new_status = "GO_APPROVED" if decision=="APPROVE" else "NO_GO_CLOSED" if decision=="REJECT" else "SUBMITTED"
    await execute(conn,
        "UPDATE opportunities SET status=$1,updated_by=$2,updated_at=NOW() WHERE opp_id=$3 AND company_id=$4",
        new_status, current_user.user_id, opp_id, company_id)
    await execute(conn,
        "INSERT INTO approvals (opp_id,approval_type,approver_id,status,decision,comments,decided_at,company_id) VALUES ($1,'MANAGER_REVIEW',$2,$3,$4,$5,NOW(),$6)",
        opp_id, current_user.user_id,
        "APPROVED" if decision=="APPROVE" else "REJECTED",
        decision, body.get("comments"), company_id)
    if decision == "APPROVE" and body.get("presales_id"):
        await execute(conn,
            "UPDATE opportunities SET presales_eng_id=$1,status='ASSIGNED_PRESALES',current_step='PRESALES_EVALUATION' WHERE opp_id=$2 AND company_id=$3",
            body["presales_id"], opp_id, company_id)
        await execute(conn,
            "INSERT INTO presales_evaluations (opp_id,evaluator_id,status) VALUES ($1,$2,'DRAFT') ON CONFLICT DO NOTHING",
            opp_id, body["presales_id"])
    return {"message": f"Decision: {decision}"}

@router.post("/{opp_id}/presales-evaluation")
async def submit_presales_eval(opp_id:int, body:dict, conn=Depends(get_db),
                               current_user=Depends(require_roles("PRESALES","ADMIN"))):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    await execute(conn,
        """UPDATE presales_evaluations SET
               opp_understanding=$1,technical_fit=$2,solution_availability=$3,
               resource_availability=$4,impl_complexity=$5,delivery_timeline=$6,
               required_vendors=$7,required_partners=$8,technical_risks=$9,
               commercial_risks=$10,competitor_info=$11,customer_relationship=$12,
               strategic_value=$13,comments=$14,recommendation=$15,
               status='SUBMITTED',submitted_at=NOW(),updated_at=NOW()
           WHERE opp_id=$16""",
        body.get("opp_understanding"), body.get("technical_fit"),
        body.get("solution_availability"), body.get("resource_availability"),
        body.get("impl_complexity"), body.get("delivery_timeline"),
        body.get("required_vendors"), body.get("required_partners"),
        body.get("technical_risks"), body.get("commercial_risks"),
        body.get("competitor_info"), body.get("customer_relationship"),
        body.get("strategic_value"), body.get("comments"),
        body.get("recommendation"), opp_id)
    rec = body.get("recommendation")
    new_status = "GO_APPROVED" if rec=="GO" else "NO_GO_CLOSED"
    await execute(conn,
        "UPDATE opportunities SET status=$1,go_nogo_decision=$2,updated_at=NOW() WHERE opp_id=$3 AND company_id=$4",
        new_status, rec, opp_id, company_id)
    if rec == "GO":
        count = await fetch_val(conn, "SELECT COUNT(*) FROM purchase_requests") or 0
        pr_number = f"PR-{__import__('datetime').datetime.now().year}-{str(count+1).zfill(5)}"
        opp = await fetch_one(conn, "SELECT * FROM opportunities WHERE opp_id=$1 AND company_id=$2", opp_id, company_id)
        await execute(conn,
            "INSERT INTO purchase_requests (pr_number,opp_id,customer_name,procurement_type,status,company_id) VALUES ($1,$2,$3,$4,'PURCHASE_PENDING',$5)",
            pr_number, opp_id, opp.get("customer_name"), opp.get("procurement_type"), company_id)
    return {"message": f"Evaluation submitted. Recommendation: {rec}"}

@router.get("/{opp_id}/timeline")
async def get_timeline(opp_id:int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await _own_opp_or_404(conn, opp_id, company_id)
    logs = await fetch_all(conn,
        "SELECT al.*,u.full_name AS actor FROM audit_logs al LEFT JOIN users u ON al.user_id=u.user_id WHERE al.record_id=$1 AND al.record_type='OPPORTUNITY' AND al.company_id=$2 ORDER BY al.action_at",
        opp_id, company_id)
    approvals = await fetch_all(conn,
        "SELECT a.*,u.full_name AS approver_name FROM approvals a JOIN users u ON a.approver_id=u.user_id WHERE a.opp_id=$1 AND a.company_id=$2 ORDER BY a.created_at",
        opp_id, company_id)
    return {"audit_logs":logs,"approvals":approvals}
