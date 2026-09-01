from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/evaluations", tags=["Evaluations"])

class TemplateCreate(BaseModel):
    tmpl_name: str
    description: Optional[str] = None
    bid_type_id: Optional[int] = None

class CriterionCreate(BaseModel):
    crit_name: str
    crit_type: str = "TECHNICAL"
    weight: float
    max_score: float = 100
    description: Optional[str] = None
    sort_order: int = 0

class ScoreSubmit(BaseModel):
    crit_id: int
    vendor_id: int
    score: float
    comments: Optional[str] = None


@router.get("")
async def list_evaluations(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, """
        SELECT e.*, u.full_name AS evaluator_name, b.bid_number
        FROM bid_evaluations e
        JOIN users u ON e.evaluator_id=u.user_id
        JOIN bids b ON e.bid_id=b.bid_id
        ORDER BY e.created_at DESC LIMIT 50""")

@router.get("/results/{bid_id}")
async def get_results(bid_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, """
        SELECT e.*, u.full_name AS evaluator_name
        FROM bid_evaluations e
        JOIN users u ON e.evaluator_id=u.user_id
        WHERE e.bid_id=$1 ORDER BY e.created_at DESC""", bid_id)

@router.get("/templates")
async def list_templates(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, """
        SELECT t.*,bt.type_name AS bid_type_name,u.full_name AS created_by_name,
               (SELECT COUNT(*) FROM evaluation_criteria c WHERE c.tmpl_id=t.tmpl_id) AS criteria_count
        FROM evaluation_templates t
        LEFT JOIN bid_types bt ON t.bid_type_id=bt.type_id
        LEFT JOIN users u ON t.created_by=u.user_id
        WHERE t.is_active=TRUE ORDER BY t.tmpl_name""")

@router.post("/templates", status_code=201)
async def create_template(body: TemplateCreate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    await execute(conn,
        "INSERT INTO evaluation_templates (tmpl_name,description,bid_type_id,created_by) VALUES ($1,$2,$3,$4)",
        body.tmpl_name, body.description, body.bid_type_id, current_user.user_id)
    return await fetch_one(conn,
        "SELECT * FROM evaluation_templates ORDER BY tmpl_id DESC LIMIT 1")

@router.get("/templates/{tmpl_id}")
async def get_template(tmpl_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    tmpl = await fetch_one(conn, "SELECT * FROM evaluation_templates WHERE tmpl_id=$1", tmpl_id)
    if not tmpl: raise HTTPException(status_code=404, detail="Template not found")
    criteria = await fetch_all(conn,
        "SELECT * FROM evaluation_criteria WHERE tmpl_id=$1 ORDER BY crit_type,sort_order", tmpl_id)
    return {"template": tmpl, "criteria": criteria}

@router.post("/templates/{tmpl_id}/criteria", status_code=201)
async def add_criterion(tmpl_id: int, body: CriterionCreate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    total_weight = await fetch_val(conn,
        "SELECT COALESCE(SUM(weight),0) FROM evaluation_criteria WHERE tmpl_id=$1 AND crit_type=$2",
        tmpl_id, body.crit_type)
    if total_weight + body.weight > 100:
        raise HTTPException(status_code=400, detail=f"Total {body.crit_type} weight cannot exceed 100%")
    await execute(conn,
        """INSERT INTO evaluation_criteria (tmpl_id,crit_name,crit_type,weight,max_score,description,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
        tmpl_id, body.crit_name, body.crit_type, body.weight, body.max_score,
        body.description, body.sort_order)
    return {"message": "Criterion added"}

@router.delete("/templates/{tmpl_id}/criteria/{crit_id}")
async def delete_criterion(tmpl_id: int, crit_id: int, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    await execute(conn, "DELETE FROM evaluation_criteria WHERE crit_id=$1 AND tmpl_id=$2", crit_id, tmpl_id)
    return {"message": "Criterion deleted"}

@router.post("/bids/{bid_id}/assign", status_code=201)
async def assign_evaluator(bid_id: int, body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN","PROCUREMENT"))):
    existing = await fetch_one(conn,
        "SELECT bid_eval_id FROM bid_evaluations WHERE bid_id=$1 AND evaluator_id=$2",
        bid_id, body["evaluator_id"])
    if existing:
        raise HTTPException(status_code=409, detail="Evaluator already assigned to this bid")
    await execute(conn,
        """INSERT INTO bid_evaluations (bid_id,tmpl_id,evaluator_id,eval_type,status)
           VALUES ($1,$2,$3,$4,'ASSIGNED')""",
        bid_id, body["tmpl_id"], body["evaluator_id"], body.get("eval_type","TECHNICAL"))
    await execute(conn,
        """INSERT INTO notifications (user_id,notif_type,title,body,related_bid)
           VALUES ($1,'EVAL_ASSIGNED','Evaluation Assignment',
                   'You have been assigned to evaluate bid #'||$2,$2)""",
        body["evaluator_id"], bid_id)
    return {"message": "Evaluator assigned"}

@router.get("/bids/{bid_id}/evaluators")
async def list_evaluators(bid_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn,
        """SELECT be.*,u.full_name AS evaluator_name,u.email,t.tmpl_name
           FROM bid_evaluations be
           JOIN users u ON be.evaluator_id=u.user_id
           JOIN evaluation_templates t ON be.tmpl_id=t.tmpl_id
           WHERE be.bid_id=$1 ORDER BY be.eval_type,be.assigned_at""", bid_id)

@router.get("/bids/{bid_id}/my-evaluation")
async def get_my_evaluation(bid_id: int, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    ev = await fetch_one(conn,
        """SELECT be.*,t.tmpl_name FROM bid_evaluations be
           JOIN evaluation_templates t ON be.tmpl_id=t.tmpl_id
           WHERE be.bid_id=$1 AND be.evaluator_id=$2""",
        bid_id, current_user.user_id)
    if not ev: raise HTTPException(status_code=404, detail="No evaluation found")
    criteria = await fetch_all(conn,
        """SELECT ec.*,
                  (SELECT json_agg(json_build_object('vendor_id',es.vendor_id,'score',es.score,'comments',es.comments))
                   FROM evaluation_scores es WHERE es.crit_id=ec.crit_id AND es.bid_eval_id=$1) AS scores
           FROM evaluation_criteria ec WHERE ec.tmpl_id=$2 ORDER BY ec.crit_type,ec.sort_order""",
        ev["bid_eval_id"], ev["tmpl_id"])
    vendors = await fetch_all(conn,
        """SELECT v.vendor_id,v.company_name FROM invitations i
           JOIN vendors v ON i.vendor_id=v.vendor_id
           WHERE i.bid_id=$1 AND i.status IN ('ACCEPTED','SENT')""", bid_id)
    return {"evaluation": ev, "criteria": criteria, "vendors": vendors}

@router.post("/bids/{bid_id}/score")
async def save_score(bid_id: int, body: ScoreSubmit, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    ev = await fetch_one(conn,
        "SELECT bid_eval_id FROM bid_evaluations WHERE bid_id=$1 AND evaluator_id=$2 AND status='ASSIGNED'",
        bid_id, current_user.user_id)
    if not ev: raise HTTPException(status_code=404, detail="No active evaluation")
    max_score = await fetch_val(conn,
        "SELECT max_score FROM evaluation_criteria WHERE crit_id=$1", body.crit_id)
    if body.score > max_score:
        raise HTTPException(status_code=400, detail=f"Score cannot exceed {max_score}")
    existing = await fetch_one(conn,
        "SELECT score_id FROM evaluation_scores WHERE bid_eval_id=$1 AND crit_id=$2 AND vendor_id=$3",
        ev["bid_eval_id"], body.crit_id, body.vendor_id)
    if existing:
        await execute(conn,
            "UPDATE evaluation_scores SET score=$1,comments=$2,scored_at=NOW() WHERE score_id=$3",
            body.score, body.comments, existing["score_id"])
    else:
        await execute(conn,
            """INSERT INTO evaluation_scores (bid_eval_id,crit_id,vendor_id,score,max_score,comments)
               VALUES ($1,$2,$3,$4,$5,$6)""",
            ev["bid_eval_id"], body.crit_id, body.vendor_id, body.score, max_score, body.comments)
    return {"message": "Score saved"}

@router.post("/bids/{bid_id}/submit")
async def submit_evaluation(bid_id: int, body: dict, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    ev = await fetch_one(conn,
        "SELECT bid_eval_id FROM bid_evaluations WHERE bid_id=$1 AND evaluator_id=$2 AND status='ASSIGNED'",
        bid_id, current_user.user_id)
    if not ev: raise HTTPException(status_code=404, detail="No active evaluation")
    # Auto-calculate total score
    total = await fetch_val(conn,
        """SELECT COALESCE(SUM(es.score * ec.weight / 100),0)
           FROM evaluation_scores es JOIN evaluation_criteria ec ON es.crit_id=ec.crit_id
           WHERE es.bid_eval_id=$1""", ev["bid_eval_id"])
    await execute(conn,
        """UPDATE bid_evaluations SET status='SUBMITTED',total_score=$1,
           comments=$2,submitted_at=NOW() WHERE bid_eval_id=$3""",
        float(total), body.get("comments"), ev["bid_eval_id"])
    return {"message": "Evaluation submitted", "total_score": float(total)}

@router.get("/bids/{bid_id}/results")
async def evaluation_results(bid_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    evaluators = await fetch_all(conn,
        """SELECT be.*,u.full_name AS evaluator_name FROM bid_evaluations be
           JOIN users u ON be.evaluator_id=u.user_id WHERE be.bid_id=$1 ORDER BY be.eval_type""", bid_id)
    ranking = await fetch_all(conn,
        """SELECT v.vendor_id,v.company_name AS vendor_name,
                  ROUND(SUM(es.score * ec.weight / 100)::numeric,2) AS weighted_score,
                  COUNT(es.score_id) AS criteria_count,
                  RANK() OVER (ORDER BY SUM(es.score * ec.weight / 100) DESC) AS ranking
           FROM bid_evaluations be
           JOIN evaluation_scores es ON be.bid_eval_id=es.bid_eval_id
           JOIN evaluation_criteria ec ON es.crit_id=ec.crit_id
           JOIN vendors v ON es.vendor_id=v.vendor_id
           WHERE be.bid_id=$1 AND be.status='SUBMITTED'
           GROUP BY v.vendor_id,v.company_name ORDER BY weighted_score DESC""", bid_id)
    return {"evaluators": evaluators, "ranking": ranking}
