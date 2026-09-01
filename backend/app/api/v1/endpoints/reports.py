from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, require_company
from app.middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/procurement-summary")
async def procurement_summary(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT bs.status_name, bt.type_name AS bid_type,
               COUNT(b.bid_id) AS bid_count,
               COALESCE(SUM(b.budget),0) AS total_budget,
               COALESCE(AVG(b.budget),0) AS avg_budget
        FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id
        JOIN bid_types bt ON b.bid_type_id=bt.type_id
        WHERE b.is_deleted=FALSE AND b.company_id=$1
        GROUP BY bs.status_name, bt.type_name ORDER BY bid_count DESC""", company_id)

@router.get("/vendor-performance")
async def vendor_performance(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT v.company_name, v.business_category,
               COUNT(vp.perf_id) AS evaluations,
               ROUND(AVG(vp.eval_score)::numeric,2) AS avg_eval_score,
               ROUND(AVG(vp.delivery_rating)::numeric,2) AS avg_delivery,
               COALESCE(SUM(vp.late_deliveries),0) AS total_late,
               COUNT(c.contract_id) AS total_contracts,
               v.is_blacklisted
        FROM vendors v
        LEFT JOIN vendor_performance vp ON v.vendor_id=vp.vendor_id
        LEFT JOIN contracts c ON v.vendor_id=c.vendor_id AND c.is_deleted=FALSE
        WHERE v.is_deleted=FALSE AND v.company_id=$1
        GROUP BY v.company_name, v.business_category, v.is_blacklisted
        ORDER BY avg_eval_score DESC NULLS LAST""", company_id)

@router.get("/audit-trail")
async def audit_trail(page: int=Query(1,ge=1), page_size: int=Query(50),
    conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    sql = """SELECT al.*, u.full_name AS user_name, u.username
             FROM audit_logs al LEFT JOIN users u ON al.user_id=u.user_id
             WHERE al.company_id=$1
             ORDER BY al.action_at DESC"""
    return await fetch_page(conn, sql, [company_id], page, page_size)

@router.get("/kpis")
async def kpis(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    award_rate = await fetch_one(conn, """
        SELECT COUNT(CASE WHEN bs.status_code='AWARDED' THEN 1 END) AS awarded,
               COUNT(*) AS total,
               ROUND(COUNT(CASE WHEN bs.status_code='AWARDED' THEN 1 END)*100.0/NULLIF(COUNT(*),0),1) AS rate
        FROM bids b JOIN bid_statuses bs ON b.status_id=bs.status_id WHERE b.is_deleted=FALSE AND b.company_id=$1""", company_id)
    dept_activity = await fetch_all(conn, """
        SELECT d.dept_name, COUNT(b.bid_id) AS bid_count, COALESCE(SUM(b.budget),0) AS total_budget
        FROM departments d LEFT JOIN bids b ON d.dept_id=b.dept_id AND b.is_deleted=FALSE AND b.company_id=$1
        GROUP BY d.dept_name ORDER BY bid_count DESC LIMIT 5""", company_id)
    return {"award_rate": award_rate, "dept_activity": dept_activity}

@router.get("/opportunities-pipeline")
async def pipeline(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    by_status = await fetch_all(conn, """
        SELECT status, COUNT(*) AS count, COALESCE(SUM(tcv),0) AS total_tcv
        FROM opportunities_v2 WHERE is_deleted=FALSE AND company_id=$1 GROUP BY status ORDER BY count DESC""", company_id)
    by_family = await fetch_all(conn, """
        SELECT COALESCE(sf.family_name,'Unclassified') AS family_name,
               COUNT(o.opp_id) AS count, COALESCE(SUM(o.tcv),0) AS total_tcv,
               COUNT(CASE WHEN o.status='WON' THEN 1 END) AS won,
               COUNT(CASE WHEN o.status='LOST' THEN 1 END) AS lost
        FROM opportunities_v2 o LEFT JOIN solution_families sf ON o.family_id=sf.family_id
        WHERE o.is_deleted=FALSE AND o.company_id=$1 GROUP BY sf.family_name ORDER BY count DESC""", company_id)
    monthly = await fetch_all(conn, """
        SELECT TO_CHAR(created_at,'YYYY-MM') AS month, COUNT(*) AS created,
               COUNT(CASE WHEN status='WON' THEN 1 END) AS won,
               COUNT(CASE WHEN status='LOST' THEN 1 END) AS lost,
               COALESCE(SUM(tcv),0) AS total_tcv
        FROM opportunities_v2 WHERE is_deleted=FALSE AND company_id=$1
        GROUP BY month ORDER BY month DESC LIMIT 12""", company_id)
    totals = await fetch_one(conn, """
        SELECT COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN status='WON' THEN tcv END),0) AS won_tcv,
               COALESCE(SUM(CASE WHEN status='LOST' THEN tcv END),0) AS lost_tcv,
               COALESCE(SUM(CASE WHEN status NOT IN ('WON','LOST','DROPPED','CANCELLED') THEN tcv END),0) AS pipeline_tcv,
               COUNT(CASE WHEN status='WON' THEN 1 END) AS won_count,
               COUNT(CASE WHEN status='LOST' THEN 1 END) AS lost_count,
               ROUND(100.0*COUNT(CASE WHEN status='WON' THEN 1 END)/NULLIF(COUNT(CASE WHEN status IN ('WON','LOST') THEN 1 END),0),1) AS win_rate
        FROM opportunities_v2 WHERE is_deleted=FALSE AND company_id=$1""", company_id)
    return {"by_status": by_status, "by_family": by_family, "monthly": monthly, "totals": totals}

@router.get("/won-analysis")
async def won_analysis(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    totals = await fetch_one(conn, """
        SELECT COUNT(*) AS total_won,
               COALESCE(SUM(tcv),0) AS total_tcv,
               COALESCE(SUM(final_value),0) AS total_final_value,
               ROUND(COALESCE(AVG(discount_applied),0),2) AS avg_discount_pct,
               COUNT(CASE WHEN invoice_status='PAID' THEN 1 END) AS paid_count,
               COUNT(CASE WHEN invoice_status='NOT_INVOICED' THEN 1 END) AS not_invoiced_count,
               COALESCE(SUM(CASE WHEN invoice_status='PAID' THEN final_value END),0) AS revenue_collected,
               COALESCE(SUM(CASE WHEN invoice_status!='PAID' THEN final_value END),0) AS revenue_outstanding
        FROM won_records WHERE is_deleted=FALSE AND won_status='ACTIVE' AND company_id=$1""", company_id)
    by_invoice = await fetch_all(conn, """
        SELECT invoice_status, COUNT(*) AS count, COALESCE(SUM(final_value),0) AS total_value
        FROM won_records WHERE is_deleted=FALSE AND company_id=$1 GROUP BY invoice_status ORDER BY count DESC""", company_id)
    by_sales_rep = await fetch_all(conn, """
        SELECT COALESCE(u.full_name,'Unknown') AS sales_rep, COUNT(*) AS won_count,
               COALESCE(SUM(w.final_value),0) AS total_value
        FROM won_records w LEFT JOIN users u ON w.sales_rep_id=u.user_id
        WHERE w.is_deleted=FALSE AND w.company_id=$1 GROUP BY u.full_name ORDER BY won_count DESC LIMIT 10""", company_id)
    recent = await fetch_all(conn, """
        SELECT w.won_number, w.customer_name, w.won_date, w.tcv, w.final_value,
               w.discount_applied, w.invoice_status, u.full_name AS sales_rep_name
        FROM won_records w LEFT JOIN users u ON w.sales_rep_id=u.user_id
        WHERE w.is_deleted=FALSE AND w.company_id=$1 ORDER BY w.created_at DESC LIMIT 10""", company_id)
    return {"totals": totals, "by_invoice": by_invoice, "by_sales_rep": by_sales_rep, "recent": recent}

@router.get("/lost-analysis")
async def lost_analysis(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    totals = await fetch_one(conn, """
        SELECT COUNT(*) AS total_lost,
               COALESCE(SUM(tcv),0) AS total_tcv_lost,
               COUNT(CASE WHEN loss_type='LOST_FINANCIALLY' THEN 1 END) AS financial_losses,
               COUNT(CASE WHEN loss_type='LOST_TECHNICAL' THEN 1 END) AS technical_losses,
               COUNT(CASE WHEN loss_type='CANCELLED' THEN 1 END) AS cancelled,
               COUNT(CASE WHEN could_revisit=TRUE THEN 1 END) AS revisit_opportunities,
               COUNT(DISTINCT competitor_name) FILTER (WHERE competitor_name IS NOT NULL) AS unique_competitors
        FROM lost_records WHERE is_deleted=FALSE AND company_id=$1""", company_id)
    by_type = await fetch_all(conn, """
        SELECT loss_type, COUNT(*) AS count, COALESCE(SUM(tcv),0) AS total_tcv
        FROM lost_records WHERE is_deleted=FALSE AND company_id=$1 GROUP BY loss_type ORDER BY count DESC""", company_id)
    by_competitor = await fetch_all(conn, """
        SELECT competitor_name, COUNT(*) AS losses, COALESCE(SUM(tcv),0) AS total_tcv_lost
        FROM lost_records WHERE is_deleted=FALSE AND competitor_name IS NOT NULL AND company_id=$1
        GROUP BY competitor_name ORDER BY losses DESC LIMIT 10""", company_id)
    monthly = await fetch_all(conn, """
        SELECT TO_CHAR(created_at,'YYYY-MM') AS month, COUNT(*) AS count, COALESCE(SUM(tcv),0) AS total_tcv
        FROM lost_records WHERE is_deleted=FALSE AND company_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12""", company_id)
    return {"totals": totals, "by_type": by_type, "by_competitor": by_competitor, "monthly": monthly}

@router.get("/deadlines-overview")
async def deadlines_overview(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    upcoming = await fetch_all(conn, """
        SELECT o.opp_number, o.customer_name, o.status, o.submission_deadline,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_left,
               u.full_name AS bid_manager_name, o.bond_required, o.bond_reminder_sent
        FROM opportunities_v2 o LEFT JOIN users u ON o.bid_manager_id=u.user_id
        WHERE o.is_deleted=FALSE AND o.company_id=$1
          AND o.submission_deadline BETWEEN NOW() AND NOW()+INTERVAL '30 days'
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
        ORDER BY o.submission_deadline""", company_id)
    overdue = await fetch_all(conn, """
        SELECT o.opp_number, o.customer_name, o.status, o.submission_deadline,
               EXTRACT(DAY FROM NOW()-o.submission_deadline)::INT AS days_overdue
        FROM opportunities_v2 o
        WHERE o.is_deleted=FALSE AND o.company_id=$1 AND o.submission_deadline < NOW()
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
        ORDER BY o.submission_deadline""", company_id)
    bond_pending = await fetch_all(conn, """
        SELECT o.opp_number, o.customer_name, o.submission_deadline,
               EXTRACT(DAY FROM o.submission_deadline - NOW())::INT AS days_left,
               o.bond_reminder_sent
        FROM opportunities_v2 o
        WHERE o.is_deleted=FALSE AND o.company_id=$1 AND o.bond_required=TRUE
          AND o.status NOT IN ('WON','LOST','DROPPED','CANCELLED')
        ORDER BY o.submission_deadline""", company_id)
    return {"upcoming": upcoming, "overdue": overdue, "bond_pending": bond_pending}

@router.get("/team-performance")
async def team_performance(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    sales = await fetch_all(conn, """
        SELECT u.full_name AS name, u.job_title,
               COUNT(o.opp_id) AS total_opps,
               COUNT(CASE WHEN o.status='WON' THEN 1 END) AS won,
               COUNT(CASE WHEN o.status='LOST' THEN 1 END) AS lost,
               COALESCE(SUM(CASE WHEN o.status='WON' THEN o.tcv END),0) AS won_tcv,
               ROUND(100.0*COUNT(CASE WHEN o.status='WON' THEN 1 END)/NULLIF(COUNT(CASE WHEN o.status IN ('WON','LOST') THEN 1 END),0),1) AS win_rate
        FROM users u LEFT JOIN opportunities_v2 o ON o.sales_rep_id=u.user_id AND o.is_deleted=FALSE
        WHERE u.is_active=TRUE AND u.company_id=$1 GROUP BY u.user_id, u.full_name, u.job_title
        HAVING COUNT(o.opp_id) > 0 ORDER BY won_tcv DESC NULLS LAST""", company_id)
    presales = await fetch_all(conn, """
        SELECT u.full_name AS name, u.job_title,
               COUNT(o.opp_id) AS total_opps,
               COUNT(CASE WHEN o.status='WON' THEN 1 END) AS won,
               ROUND(100.0*COUNT(CASE WHEN o.status='WON' THEN 1 END)/NULLIF(COUNT(CASE WHEN o.status IN ('WON','LOST') THEN 1 END),0),1) AS win_rate
        FROM users u LEFT JOIN opportunities_v2 o ON o.presales_id=u.user_id AND o.is_deleted=FALSE
        WHERE u.is_active=TRUE AND u.company_id=$1 GROUP BY u.user_id, u.full_name, u.job_title
        HAVING COUNT(o.opp_id) > 0 ORDER BY won DESC NULLS LAST""", company_id)
    return {"sales": sales, "presales": presales}
