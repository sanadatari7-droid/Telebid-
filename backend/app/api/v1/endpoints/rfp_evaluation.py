"""Sub-module A of Modules 2–4 — Go / No-Go evaluation of an RFP.

The bid department sets the questions once per module: each has a weight (all weights
add up to 100%) and answer options, each worth a % of that weight. For an RFP, the score
is the sum of weight × answer value. It's a Go only when the score reaches the pass mark
and the business case EBITDA meets the minimum set in Module 1 / Sub-module C.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user, require_roles
from app.api.v1.endpoints.rfps import MODULES, Module, require_rfp

router = APIRouter(prefix="/rfps", tags=["RFP evaluation"])

DEFAULT_PASS_MARK = 60.0


class OptionIn(BaseModel):
    option_id: Optional[int] = None
    label: str = Field(..., min_length=1, max_length=100)
    value: float = Field(..., ge=0, le=100)


class QuestionIn(BaseModel):
    question_id: Optional[int] = None
    question: str = Field(..., min_length=1, max_length=1000)
    weight: float = Field(..., gt=0, le=100)
    evaluator_title: Optional[str] = Field(None, max_length=150)
    options: List[OptionIn] = Field(..., min_length=1)


class EvalConfigIn(BaseModel):
    pass_mark: float = Field(DEFAULT_PASS_MARK, ge=0, le=100)
    questions: List[QuestionIn] = Field(default_factory=list)


class AnswerIn(BaseModel):
    question_id: int
    option_id: int
    comment: Optional[str] = Field(None, max_length=2000)


class EvaluationIn(BaseModel):
    ebitda_pct: Optional[float] = Field(None, ge=-100, le=100)
    answers: List[AnswerIn] = Field(default_factory=list)


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _config(conn, company_id: int, code: str) -> dict:
    pass_mark = await fetch_val(conn, "SELECT pass_mark FROM rfp_eval_settings WHERE company_id=$1 AND module=$2",
                                company_id, code)
    questions = await fetch_all(conn, """
        SELECT question_id, question, weight, evaluator_title, sort_order
        FROM rfp_eval_questions WHERE company_id=$1 AND module=$2 AND is_active=TRUE
        ORDER BY sort_order, question_id""", company_id, code)
    options = await fetch_all(conn, """
        SELECT o.option_id, o.question_id, o.label, o.value, o.sort_order
        FROM rfp_eval_options o JOIN rfp_eval_questions q ON q.question_id=o.question_id
        WHERE q.company_id=$1 AND q.module=$2 AND q.is_active=TRUE AND o.is_active=TRUE
        ORDER BY o.sort_order, o.option_id""", company_id, code)
    by_q = {}
    for o in options:
        by_q.setdefault(o["question_id"], []).append(o)
    for q in questions:
        q["options"] = by_q.get(q["question_id"], [])
    return {"pass_mark": float(pass_mark) if pass_mark is not None else DEFAULT_PASS_MARK, "questions": questions}


async def _evaluator_titles(conn, company_id: int) -> dict:
    rows = await fetch_all(conn, """
        SELECT title, full_name FROM company_evaluators
        WHERE company_id=$1 AND is_active=TRUE ORDER BY title, full_name""", company_id)
    titles = {}
    for r in rows:
        titles.setdefault(r["title"], []).append(r["full_name"])
    return titles


def _result(config: dict, answers: dict, ebitda_pct, ebitda_min) -> dict:
    """answers: {question_id: option_id}. Returns score, recommendation and the reasons behind it."""
    questions = config["questions"]
    if not questions:
        return {"score": None, "recommendation": "NOT_SET_UP",
                "reasons": ["No evaluation questions have been set up yet"], "answered": 0, "total": 0}
    score, answered = 0.0, 0
    for q in questions:
        opt = next((o for o in q["options"] if o["option_id"] == answers.get(q["question_id"])), None)
        if opt:
            answered += 1
            score += float(q["weight"]) * float(opt["value"]) / 100
    score = round(score, 2)
    missing = []
    if answered < len(questions):
        n = len(questions) - answered
        missing.append(f"{n} question{'s' if n != 1 else ''} still to answer")
    if ebitda_min is not None and ebitda_pct is None:
        missing.append("Enter the business case EBITDA")
    base = {"score": score, "answered": answered, "total": len(questions)}
    if missing:
        return {**base, "recommendation": "INCOMPLETE", "reasons": missing}
    reasons = []
    if score < config["pass_mark"]:
        reasons.append(f"Score {score:g}% is below the {config['pass_mark']:g}% pass mark")
    if ebitda_min is not None and float(ebitda_pct) < float(ebitda_min):
        reasons.append(f"EBITDA {float(ebitda_pct):g}% is below the {float(ebitda_min):g}% minimum")
    if reasons:
        return {**base, "recommendation": "NO_GO", "reasons": reasons}
    ok = [f"Score {score:g}% meets the {config['pass_mark']:g}% pass mark"]
    if ebitda_min is not None:
        ok.append(f"EBITDA {float(ebitda_pct):g}% meets the {float(ebitda_min):g}% minimum")
    return {**base, "recommendation": "GO", "reasons": ok}


# ── Questions setup (set once per module) ─────────────────────────────────────

@router.get("/{module}/eval-config")
async def get_eval_config(module: Module, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return {**await _config(conn, company_id, MODULES[module].code), "titles": await _evaluator_titles(conn, company_id)}


@router.put("/{module}/eval-config")
async def save_eval_config(module: Module, body: EvalConfigIn, conn=Depends(get_db),
                           current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    code = MODULES[module].code
    if body.questions:
        total = round(sum(q.weight for q in body.questions), 2)
        if abs(total - 100) > 0.01:
            raise HTTPException(status_code=400, detail=f"The question weights must add up to 100% (they add up to {total:g}%)")
    titles = await _evaluator_titles(conn, company_id)
    existing_q = {r["question_id"] for r in await fetch_all(conn,
        "SELECT question_id FROM rfp_eval_questions WHERE company_id=$1 AND module=$2 AND is_active=TRUE",
        company_id, code)}
    for i, q in enumerate(body.questions, 1):
        if not q.question.strip():
            raise HTTPException(status_code=400, detail=f"Question {i} is empty")
        if q.question_id and q.question_id not in existing_q:
            raise HTTPException(status_code=400, detail="One of the questions no longer exists — reload and try again")
        if q.evaluator_title and q.evaluator_title not in titles:
            raise HTTPException(status_code=400, detail=f"No evaluator has the title \"{q.evaluator_title}\" (Company Settings → Evaluators)")
        labels = [o.label.strip().lower() for o in q.options]
        if len(set(labels)) != len(labels):
            raise HTTPException(status_code=400, detail=f"Question {i} has the same answer twice")

    async with conn.transaction():
        await execute(conn, """
            INSERT INTO rfp_eval_settings (company_id, module, pass_mark, updated_at) VALUES ($1,$2,$3,NOW())
            ON CONFLICT (company_id, module) DO UPDATE SET pass_mark=EXCLUDED.pass_mark, updated_at=NOW()""",
            company_id, code, body.pass_mark)
        kept = set()
        for i, q in enumerate(body.questions, 1):
            if q.question_id:
                qid = q.question_id
                await execute(conn, """
                    UPDATE rfp_eval_questions SET question=$1, weight=$2, evaluator_title=$3, sort_order=$4
                    WHERE question_id=$5 AND company_id=$6 AND module=$7""",
                    q.question.strip(), q.weight, q.evaluator_title or None, i, qid, company_id, code)
            else:
                qid = await fetch_val(conn, """
                    INSERT INTO rfp_eval_questions (company_id, module, question, weight, evaluator_title, sort_order)
                    VALUES ($1,$2,$3,$4,$5,$6) RETURNING question_id""",
                    company_id, code, q.question.strip(), q.weight, q.evaluator_title or None, i)
            kept.add(qid)
            existing_o = {r["option_id"] for r in await fetch_all(conn,
                "SELECT option_id FROM rfp_eval_options WHERE question_id=$1 AND is_active=TRUE", qid)}
            kept_o = set()
            for j, o in enumerate(q.options, 1):
                if o.option_id and o.option_id in existing_o:
                    await execute(conn, "UPDATE rfp_eval_options SET label=$1, value=$2, sort_order=$3 WHERE option_id=$4",
                                  o.label.strip(), o.value, j, o.option_id)
                    kept_o.add(o.option_id)
                else:
                    kept_o.add(await fetch_val(conn, """
                        INSERT INTO rfp_eval_options (question_id, label, value, sort_order) VALUES ($1,$2,$3,$4)
                        RETURNING option_id""", qid, o.label.strip(), o.value, j))
            gone = list(existing_o - kept_o)
            if gone:
                await execute(conn, "UPDATE rfp_eval_options SET is_active=FALSE WHERE option_id = ANY($1::int[])", gone)
        removed = list(existing_q - kept)
        if removed:
            await execute(conn, "UPDATE rfp_eval_questions SET is_active=FALSE WHERE question_id = ANY($1::int[])", removed)
    return {**await _config(conn, company_id, code), "titles": titles}


# ── Per-RFP evaluation ────────────────────────────────────────────────────────

async def _evaluation(conn, module: Module, rfp_id: int, company_id: int) -> dict:
    spec = await require_rfp(conn, module, rfp_id, company_id)
    config = await _config(conn, company_id, spec.code)
    answers = await fetch_all(conn, """
        SELECT a.question_id, a.option_id, a.comment, a.answered_at, u.full_name AS answered_by_name
        FROM rfp_eval_answers a LEFT JOIN users u ON u.user_id=a.answered_by
        WHERE a.rfp_id=$1""", rfp_id)
    ev = await fetch_one(conn, "SELECT ebitda_pct, updated_at FROM rfp_evaluations WHERE rfp_id=$1", rfp_id)
    ebitda_pct = float(ev["ebitda_pct"]) if ev and ev["ebitda_pct"] is not None else None
    ebitda_min = await fetch_val(conn, "SELECT ebitda_min_pct FROM company_pricing_approval WHERE company_id=$1", company_id)
    ebitda_min = float(ebitda_min) if ebitda_min is not None else None
    result = _result(config, {a["question_id"]: a["option_id"] for a in answers}, ebitda_pct, ebitda_min)
    return {
        **config, "answers": answers, "ebitda_pct": ebitda_pct, "ebitda_min": ebitda_min,
        "titles": await _evaluator_titles(conn, company_id), "result": result,
        "updated_at": ev["updated_at"] if ev else None,
    }


@router.get("/{module}/{rfp_id:int}/evaluation")
async def get_evaluation(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _evaluation(conn, module, rfp_id, require_company(current_user))


@router.put("/{module}/{rfp_id:int}/evaluation")
async def save_evaluation(module: Module, rfp_id: int, body: EvaluationIn, conn=Depends(get_db),
                          current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    spec = await require_rfp(conn, module, rfp_id, company_id)
    config = await _config(conn, company_id, spec.code)
    valid = {q["question_id"]: {o["option_id"] for o in q["options"]} for q in config["questions"]}
    seen = set()
    for a in body.answers:
        if a.question_id not in valid or a.option_id not in valid[a.question_id]:
            raise HTTPException(status_code=400, detail="An answer doesn't match the current questions — reload and try again")
        if a.question_id in seen:
            raise HTTPException(status_code=400, detail="A question was answered twice")
        seen.add(a.question_id)

    ebitda_min = await fetch_val(conn, "SELECT ebitda_min_pct FROM company_pricing_approval WHERE company_id=$1", company_id)
    result = _result(config, {a.question_id: a.option_id for a in body.answers}, body.ebitda_pct,
                     float(ebitda_min) if ebitda_min is not None else None)
    async with conn.transaction():
        await execute(conn, "DELETE FROM rfp_eval_answers WHERE rfp_id=$1 AND NOT (question_id = ANY($2::int[]))",
                      rfp_id, list(seen))
        for a in body.answers:
            # Who answered (and when) only changes when the answer itself changes.
            await execute(conn, """
                INSERT INTO rfp_eval_answers (rfp_id, question_id, option_id, comment, answered_by, answered_at)
                VALUES ($1,$2,$3,$4,$5,NOW())
                ON CONFLICT (rfp_id, question_id) DO UPDATE SET
                    option_id=EXCLUDED.option_id, comment=EXCLUDED.comment,
                    answered_by = CASE WHEN rfp_eval_answers.option_id IS DISTINCT FROM EXCLUDED.option_id
                                         OR rfp_eval_answers.comment IS DISTINCT FROM EXCLUDED.comment
                                       THEN EXCLUDED.answered_by ELSE rfp_eval_answers.answered_by END,
                    answered_at = CASE WHEN rfp_eval_answers.option_id IS DISTINCT FROM EXCLUDED.option_id
                                         OR rfp_eval_answers.comment IS DISTINCT FROM EXCLUDED.comment
                                       THEN NOW() ELSE rfp_eval_answers.answered_at END""",
                rfp_id, a.question_id, a.option_id, (a.comment or "").strip() or None, current_user.user_id)
        await execute(conn, """
            INSERT INTO rfp_evaluations (rfp_id, ebitda_pct, score, recommendation, updated_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,NOW())
            ON CONFLICT (rfp_id) DO UPDATE SET ebitda_pct=EXCLUDED.ebitda_pct, score=EXCLUDED.score,
                recommendation=EXCLUDED.recommendation, updated_by=EXCLUDED.updated_by, updated_at=NOW()""",
            rfp_id, body.ebitda_pct, result["score"], result["recommendation"], current_user.user_id)
    return await _evaluation(conn, module, rfp_id, company_id)
