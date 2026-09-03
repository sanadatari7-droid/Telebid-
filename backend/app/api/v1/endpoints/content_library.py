from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
from app.middleware.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/content-library", tags=["Content Library"])


class ContentItemCreate(BaseModel):
    question: str
    answer: str
    category: str = "Other"
    tags: Optional[str] = None


class DraftAnswerRequest(BaseModel):
    question: str


@router.get("")
async def list_items(
    search: Optional[str] = None,
    category: Optional[str] = None,
    conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    conds = ["company_id=$1"]
    args = [company_id]
    if category:
        args.append(category); conds.append(f"category=${len(args)}")
    if search:
        args.append(search); conds.append(f"(question ILIKE '%%'||${len(args)}||'%%' OR answer ILIKE '%%'||${len(args)}||'%%')")
    rows = await fetch_all(conn,
        f"SELECT * FROM content_library_items WHERE {' AND '.join(conds)} ORDER BY updated_at DESC", *args)
    return {"items": rows}


@router.post("", status_code=201)
async def create_item(body: ContentItemCreate, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    row = await fetch_one(conn, """
        INSERT INTO content_library_items (company_id, question, answer, category, tags, created_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
        company_id, body.question, body.answer, body.category, body.tags, current_user.user_id)
    return row


@router.patch("/{item_id}")
async def update_item(item_id: int, body: dict, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    allowed = ["question", "answer", "category", "tags"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.items():
        if k in allowed:
            args.append(v); updates.append(f"{k}=${len(args)}")
    if not args:
        raise HTTPException(status_code=400, detail="Nothing to update")
    args.append(item_id); args.append(company_id)
    result = await execute(conn,
        f"UPDATE content_library_items SET {','.join(updates)} WHERE item_id=${len(args)-1} AND company_id=${len(args)}", *args)
    if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item updated"}


@router.delete("/{item_id}")
async def delete_item(item_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    result = await execute(conn, "DELETE FROM content_library_items WHERE item_id=$1 AND company_id=$2", item_id, company_id)
    if result == "DELETE 0": raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted"}


@router.post("/draft-answer")
async def draft_answer(body: DraftAnswerRequest, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """RAG answer draft: retrieves the most similar past Q&A entries from this
    company's content library (pg_trgm similarity) and asks Claude to draft a
    new answer grounded in them. Increments times_used on whichever library
    items were actually used as sources."""
    from app.services import content_rag
    company_id = require_company(current_user)
    if not content_rag.is_configured():
        raise HTTPException(status_code=503,
            detail="AI answer drafting is not configured on this server. Set ANTHROPIC_API_KEY in the backend environment to enable it.")
    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    try:
        result = await content_rag.draft_answer(conn, company_id, body.question)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI drafting failed: {e}")

    source_ids = [s["item_id"] for s in result.get("sources", [])]
    if source_ids:
        await execute(conn,
            "UPDATE content_library_items SET times_used = times_used + 1 WHERE item_id = ANY($1::int[]) AND company_id=$2",
            source_ids, company_id)
    return result
