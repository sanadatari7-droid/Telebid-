from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_all, fetch_one, fetch_val, execute, require_company
from app.middleware.auth import get_current_user
from app.services import translator

router = APIRouter(tags=["Clients"])


class ClientIn(BaseModel):
    name_en: str = Field(..., min_length=1, max_length=200)
    name_ar: Optional[str] = Field(None, max_length=200)
    billing_address_en: Optional[str] = Field(None, max_length=1000)
    billing_address_ar: Optional[str] = Field(None, max_length=1000)
    is_strategic: bool = False


class TranslateIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    kind: translator.TextKind


def _clean(v: Optional[str]) -> Optional[str]:
    v = (v or "").strip()
    return v or None


@router.get("/clients")
async def list_clients(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn,
        "SELECT * FROM clients WHERE company_id=$1 AND is_active=TRUE ORDER BY lower(name_en)", company_id)


@router.post("/clients", status_code=201)
async def create_client(body: ClientIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    name_en = body.name_en.strip()
    exists = await fetch_val(conn,
        "SELECT client_id FROM clients WHERE company_id=$1 AND is_active=TRUE AND lower(name_en)=lower($2)",
        company_id, name_en)
    if exists:
        raise HTTPException(status_code=400, detail=f"A client named \"{name_en}\" already exists — pick it from the list")
    client_id = await fetch_val(conn, """
        INSERT INTO clients (company_id, name_en, name_ar, billing_address_en, billing_address_ar, is_strategic, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING client_id""",
        company_id, name_en, _clean(body.name_ar), _clean(body.billing_address_en),
        _clean(body.billing_address_ar), body.is_strategic, current_user.user_id)
    return await fetch_one(conn, "SELECT * FROM clients WHERE client_id=$1", client_id)


@router.put("/clients/{client_id}")
async def update_client(client_id: int, body: ClientIn, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    result = await execute(conn, """
        UPDATE clients SET name_en=$1, name_ar=$2, billing_address_en=$3, billing_address_ar=$4,
               is_strategic=$5, updated_at=NOW()
        WHERE client_id=$6 AND company_id=$7 AND is_active=TRUE""",
        body.name_en.strip(), _clean(body.name_ar), _clean(body.billing_address_en),
        _clean(body.billing_address_ar), body.is_strategic, client_id, company_id)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Client not found")
    return await fetch_one(conn, "SELECT * FROM clients WHERE client_id=$1", client_id)


@router.post("/translate/arabic")
async def translate_arabic(body: TranslateIn, current_user=Depends(get_current_user)):
    try:
        return {"arabic": await translator.translate_to_arabic(body.text.strip(), body.kind)}
    except translator.TranslationUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
