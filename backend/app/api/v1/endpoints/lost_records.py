from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime
from pydantic import BaseModel, validator
from app.db.postgres import get_db, fetch_all, fetch_one, fetch_page, execute, fetch_val, require_company
from app.middleware.auth import get_current_user

router = APIRouter(prefix="/lost-records", tags=["Lost Records"])
LOSS_TYPES = ["LOST_FINANCIALLY","LOST_TECHNICAL","CANCELLED","NO_AWARD","COMPETITOR"]

class LostCreate(BaseModel):
    lost_date: date
    loss_type: str
    loss_reason: Optional[str] = None
    competitor_name: Optional[str] = None
    winner_name: Optional[str] = None
    winner_tcv: Optional[float] = None
    winner_solution: Optional[str] = None
    price_difference: Optional[float] = None
    technical_gap: Optional[str] = None
    lessons_learned: Optional[str] = None
    bid_person_notes: Optional[str] = None
    could_revisit: bool = False
    revisit_notes: Optional[str] = None
    @validator("loss_type")
    def valid_type(cls, v):
        if v not in LOSS_TYPES: raise ValueError(f"Invalid loss type")
        return v

class LostUpdate(BaseModel):
    loss_reason: Optional[str] = None
    competitor_name: Optional[str] = None
    winner_name: Optional[str] = None
    winner_tcv: Optional[float] = None
    winner_solution: Optional[str] = None
    price_difference: Optional[float] = None
    technical_gap: Optional[str] = None
    lessons_learned: Optional[str] = None
    bid_person_notes: Optional[str] = None
    could_revisit: Optional[bool] = None
    revisit_notes: Optional[str] = None

async def _gen_lost_number(conn) -> str:
    year = datetime.now().year
    count = await fetch_val(conn, "SELECT COUNT(*) FROM lost_records") or 0
    return f"LOST-{year}-{str(count+1).zfill(5)}"

@router.post("/from-opportunity/{opp_id}", status_code=201)
async def create_lost(opp_id: int, body: LostCreate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    opp = await fetch_one(conn, """
        SELECT o.*, c.symbol FROM opportunities_v2 o
        LEFT JOIN currencies c ON o.currency_id=c.currency_id
        WHERE o.opp_id=$1 AND o.is_deleted=FALSE AND o.company_id=$2""", opp_id, company_id)
    if not opp: raise HTTPException(status_code=404, detail="Opportunity not found")
    existing = await fetch_val(conn, "SELECT lost_id FROM lost_records WHERE opp_id=$1 AND is_deleted=FALSE", opp_id)
    if existing: raise HTTPException(status_code=409, detail=f"LOST record already exists (ID:{existing})")
    lost_number = await _gen_lost_number(conn)
    await execute(conn, """
        INSERT INTO lost_records (
            opp_id, lost_number, company_id,
            expro_ref, rfp_ref, customer_name, customer_name_ar,
            customer_id, customer_ref, media_type, sla_type,
            bandwidth_mbps, quantity, sow_detail, solution_detail,
            family_id, solution_id, nrc, mrc, tcv, currency_id,
            submission_deadline, sales_rep_id, presales_id, bid_manager_id,
            lost_date, loss_type, loss_reason, competitor_name, winner_name,
            winner_tcv, winner_solution, price_difference,
            technical_gap, lessons_learned, bid_person_notes,
            could_revisit, revisit_notes, lost_by
        ) VALUES (
            $1,$2,$39,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
            $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
            $31,$32,$33,$34,$35,$36,$37,$38
        )""",
        opp_id, lost_number,
        opp.get("expro_ref"), opp.get("rfp_ref"), opp.get("customer_name"), opp.get("customer_name_ar"),
        opp.get("customer_id"), opp.get("customer_ref"), opp.get("media_type"), opp.get("sla_type"),
        opp.get("bandwidth_mbps"), opp.get("quantity"), opp.get("sow_detail"), opp.get("solution_detail"),
        opp.get("family_id"), opp.get("solution_id"), opp.get("nrc"), opp.get("mrc"),
        opp.get("tcv"), opp.get("currency_id"), opp.get("submission_deadline"),
        opp.get("sales_rep_id"), opp.get("presales_id"), opp.get("bid_manager_id"),
        body.lost_date, body.loss_type, body.loss_reason, body.competitor_name, body.winner_name,
        body.winner_tcv, body.winner_solution, body.price_difference,
        body.technical_gap, body.lessons_learned, body.bid_person_notes,
        body.could_revisit, body.revisit_notes, current_user.user_id, company_id)
    lost_id = await fetch_val(conn, "SELECT lost_id FROM lost_records WHERE lost_number=$1 AND company_id=$2", lost_number, company_id)
    await execute(conn,
        "UPDATE opportunities_v2 SET status='LOST', phase='Dropped', lost_date=$1, loss_reason=$2, loss_type=$3, competitor_name=$4, winner_name=$5, winner_tcv=$6, updated_at=NOW(), updated_by=$7 WHERE opp_id=$8 AND company_id=$9",
        body.lost_date, body.loss_reason, body.loss_type, body.competitor_name, body.winner_name, body.winner_tcv, current_user.user_id, opp_id, company_id)
    try:
        await execute(conn,
            "INSERT INTO opportunity_logs (opp_id,action,field_name,old_value,new_value,performed_by,comments) VALUES ($1,'STATUS_CHANGED_TO_LOST','status','APPROVED','LOST',$2,$3)",
            opp_id, current_user.user_id, f"LOST record: {lost_number}. Type: {body.loss_type}")
    except Exception: pass
    return {"lost_id": lost_id, "lost_number": lost_number, "opp_id": opp_id, "message": f"LOST record {lost_number} created"}

@router.get("")
async def list_lost(page: int=Query(1,ge=1), page_size: int=Query(20),
    search: Optional[str]=None, loss_type: Optional[str]=None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conds, args = ["l.is_deleted=FALSE", "l.company_id=$1"], [company_id]
    if search:
        args.append(f"%{search}%")
        conds.append(f"(l.customer_name ILIKE ${len(args)} OR l.lost_number ILIKE ${len(args)} OR l.competitor_name ILIKE ${len(args)})")
    if loss_type:
        args.append(loss_type); conds.append(f"l.loss_type=${len(args)}")
    where = " AND ".join(conds)
    sql = f"""SELECT l.*, o.opp_number, sf.family_name, st.solution_name,
               c.symbol, c.currency_code, sr.full_name AS sales_rep_name,
               bm.full_name AS bid_manager_name, lb.full_name AS lost_by_name
        FROM lost_records l JOIN opportunities_v2 o ON l.opp_id=o.opp_id
        LEFT JOIN solution_families sf ON l.family_id=sf.family_id
        LEFT JOIN solution_types st ON l.solution_id=st.solution_id
        LEFT JOIN currencies c ON l.currency_id=c.currency_id
        LEFT JOIN users sr ON l.sales_rep_id=sr.user_id
        LEFT JOIN users bm ON l.bid_manager_id=bm.user_id
        LEFT JOIN users lb ON l.lost_by=lb.user_id
        WHERE {where} ORDER BY l.created_at DESC"""
    return await fetch_page(conn, sql, args, page, page_size)

@router.get("/stats")
async def lost_stats(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, """
        SELECT COUNT(*) AS total_lost, COALESCE(SUM(tcv),0) AS total_tcv_lost,
               COUNT(CASE WHEN loss_type='LOST_FINANCIALLY' THEN 1 END) AS financial_losses,
               COUNT(CASE WHEN loss_type='LOST_TECHNICAL' THEN 1 END) AS technical_losses,
               COUNT(CASE WHEN loss_type='CANCELLED' THEN 1 END) AS cancelled,
               COUNT(CASE WHEN could_revisit=TRUE THEN 1 END) AS revisit_opportunities,
               COUNT(DISTINCT competitor_name) FILTER (WHERE competitor_name IS NOT NULL) AS unique_competitors
        FROM lost_records WHERE is_deleted=FALSE AND company_id=$1""", company_id)

@router.get("/by-competitor")
async def by_competitor(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, """
        SELECT competitor_name, COUNT(*) AS losses, COALESCE(SUM(tcv),0) AS total_tcv_lost
        FROM lost_records WHERE is_deleted=FALSE AND competitor_name IS NOT NULL AND company_id=$1
        GROUP BY competitor_name ORDER BY losses DESC LIMIT 10""", company_id)

@router.get("/by-opportunity/{opp_id}")
async def get_by_opp(opp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, "SELECT * FROM lost_records WHERE opp_id=$1 AND is_deleted=FALSE AND company_id=$2", opp_id, company_id)

@router.get("/{lost_id}")
async def get_lost(lost_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    lost = await fetch_one(conn, """
        SELECT l.*, o.opp_number, sf.family_name, st.solution_name,
               c.symbol, sr.full_name AS sales_rep_name, ps.full_name AS presales_name,
               bm.full_name AS bid_manager_name, lb.full_name AS lost_by_name
        FROM lost_records l JOIN opportunities_v2 o ON l.opp_id=o.opp_id
        LEFT JOIN solution_families sf ON l.family_id=sf.family_id
        LEFT JOIN solution_types st ON l.solution_id=st.solution_id
        LEFT JOIN currencies c ON l.currency_id=c.currency_id
        LEFT JOIN users sr ON l.sales_rep_id=sr.user_id
        LEFT JOIN users ps ON l.presales_id=ps.user_id
        LEFT JOIN users bm ON l.bid_manager_id=bm.user_id
        LEFT JOIN users lb ON l.lost_by=lb.user_id
        WHERE l.lost_id=$1 AND l.is_deleted=FALSE AND l.company_id=$2""", lost_id, company_id)
    if not lost: raise HTTPException(status_code=404)
    logs = await fetch_all(conn, """
        SELECT ol.*, u.full_name AS performed_by_name
        FROM opportunity_logs ol LEFT JOIN users u ON ol.performed_by=u.user_id
        WHERE ol.opp_id=$1 AND ol.action LIKE '%LOST%' ORDER BY ol.performed_at DESC""", lost.get("opp_id"))
    return {"lost_record": lost, "audit_trail": logs}

@router.patch("/{lost_id}")
async def update_lost(lost_id: int, body: LostUpdate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    allowed = ["loss_reason","competitor_name","winner_name","winner_tcv","winner_solution",
               "price_difference","technical_gap","lessons_learned","bid_person_notes","could_revisit","revisit_notes"]
    updates, args = ["updated_at=NOW()"], []
    for k, v in body.dict(exclude_none=True).items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args: raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(lost_id); args.append(company_id)
    result = await execute(conn, f"UPDATE lost_records SET {','.join(updates)} WHERE lost_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Lost record not found")
    return {"message": "Updated"}
