"""Sub-module B of Modules 2–4 — bid bond for an RFP.

Most fields come from what's already entered: the client record, the submission date and
bid bond % (RFP details), and the company initials for the reference (Module 1 /
Sub-module A). The bond is stored with the other bonds, so it goes through the same
approval cycle and issuance-office email (Module 1 / Sub-module D) via /bonds/{id}/...
"""
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_one, execute, require_company
from app.middleware.auth import get_current_user
from app.api.v1.endpoints.company_config import get_bond_approval_config
from app.api.v1.endpoints.rfps import MODULES, Module, ModuleSpec

router = APIRouter(prefix="/rfps", tags=["RFP bid bond"])

DEFAULT_VALIDITY_DAYS = 90


class BidBondIn(BaseModel):
    bid_subject: str = Field(..., min_length=1, max_length=300)
    validity_days: int = Field(DEFAULT_VALIDITY_DAYS, ge=1, le=730)
    lg_base_value: float = Field(..., gt=0)
    bid_ref: str = Field(..., min_length=1, max_length=100)
    language: Literal["Arabic", "English"] = "Arabic"
    notes: Optional[str] = Field(None, max_length=2000)


async def _context(conn, rfp_id: int, company_id: int, spec: ModuleSpec) -> dict:
    rfp = await fetch_one(conn, """
        SELECT r.rfp_id, r.rfp_number, r.rfp_ref, r.rfp_title, r.sow, r.submission_date, r.tcv,
               r.bid_bond_required, r.bid_bond_pct,
               c.name_en, c.name_ar, c.billing_address_en, c.billing_address_ar,
               co.company_initials, co.currency_id, COALESCE(co.currency_decimals, 2) AS decimals,
               cur.currency_code
        FROM rfps r
        JOIN clients c ON c.client_id = r.client_id
        JOIN companies co ON co.company_id = r.company_id
        LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        WHERE r.rfp_id=$1 AND r.company_id=$2 AND r.module=$3""", rfp_id, company_id, spec.code)
    if not rfp:
        raise HTTPException(status_code=404, detail=f"{spec.noun[0].upper()}{spec.noun[1:]} not found")
    return rfp


def _beneficiary(rfp: dict, language: str):
    if language == "Arabic":
        return rfp["name_ar"] or rfp["name_en"], rfp["billing_address_ar"] or rfp["billing_address_en"]
    return rfp["name_en"], rfp["billing_address_en"]


def _amount(value: float, pct, decimals: int) -> Decimal:
    q = Decimal(1).scaleb(-int(decimals))
    return (Decimal(str(value)) * Decimal(str(pct)) / 100).quantize(q, rounding=ROUND_HALF_UP)


def _default_ref(rfp: dict) -> str:
    base = rfp["rfp_ref"] or rfp["rfp_number"]
    return f"{rfp['company_initials']}-RF: {base}" if rfp["company_initials"] else base


async def _payload(conn, rfp_id: int, company_id: int, spec: ModuleSpec) -> dict:
    rfp = await _context(conn, rfp_id, company_id, spec)
    bond = await fetch_one(conn, "SELECT * FROM opportunity_bonds WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    pct = rfp["bid_bond_pct"]
    defaults = {
        # EXPRO requests have no title; their SOW names what is being bid.
        "bid_subject": (rfp["rfp_title"] or rfp["sow"] or "")[:300],
        "validity_days": DEFAULT_VALIDITY_DAYS,
        "lg_base_value": float(rfp["tcv"]) if rfp["tcv"] is not None else None,
        "bid_ref": _default_ref(rfp),
        "language": "Arabic",
    }
    return {
        "rfp": {k: rfp[k] for k in ("rfp_number", "rfp_ref", "rfp_title", "sow", "submission_date", "tcv",
                                    "bid_bond_required", "bid_bond_pct", "name_en", "name_ar",
                                    "billing_address_en", "billing_address_ar", "company_initials")},
        "currency": {"code": rfp["currency_code"], "decimals": rfp["decimals"]},
        "default_validity_days": DEFAULT_VALIDITY_DAYS,
        "defaults": defaults if pct is not None else None,
        "bond": bond,
    }


@router.get("/{module}/{rfp_id:int}/bid-bond")
async def get_bid_bond(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _payload(conn, rfp_id, require_company(current_user), MODULES[module])


@router.put("/{module}/{rfp_id:int}/bid-bond")
async def save_bid_bond(module: Module, rfp_id: int, body: BidBondIn, conn=Depends(get_db),
                        current_user=Depends(get_current_user)):
    spec = MODULES[module]
    company_id = require_company(current_user)
    rfp = await _context(conn, rfp_id, company_id, spec)
    if not rfp["bid_bond_required"] or rfp["bid_bond_pct"] is None:
        raise HTTPException(status_code=400,
            detail=f"This {spec.noun} doesn't need a bid bond. Set \"Bid bond required\" to Yes, with a percentage, "
                   f"in the {spec.noun} details.")
    existing = await fetch_one(conn,
        "SELECT bond_id, approval_level, status FROM opportunity_bonds WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if existing and (existing["approval_level"] or 0) > 0:
        raise HTTPException(status_code=400, detail="This bid bond is already being approved, so its details can't change")

    beneficiary, address = _beneficiary(rfp, body.language)
    expiry = rfp["submission_date"] + timedelta(days=body.validity_days)
    amount = _amount(body.lg_base_value, rfp["bid_bond_pct"], rfp["decimals"])
    office = (await get_bond_approval_config(conn, company_id))["office_name"]
    values = (body.bid_ref.strip(), body.bid_subject.strip(), beneficiary, address, rfp["bid_bond_pct"],
              body.lg_base_value, amount, rfp["currency_id"] or 1, rfp["submission_date"], expiry,
              body.validity_days, body.language, (body.notes or "").strip() or None)
    if existing:
        await execute(conn, """
            UPDATE opportunity_bonds SET bid_ref=$1, bid_subject=$2, beneficiary=$3, beneficiary_address=$4,
                   lg_percentage=$5, lg_base_value=$6, bond_amount=$7, currency_id=$8, submission_date=$9,
                   expiry_date=$10, validity_days=$11, language=$12, notes=$13, updated_at=NOW()
            WHERE bond_id=$14 AND company_id=$15""", *values, existing["bond_id"], company_id)
    else:
        await execute(conn, """
            INSERT INTO opportunity_bonds (bid_ref, bid_subject, beneficiary, beneficiary_address, lg_percentage,
                   lg_base_value, bond_amount, currency_id, submission_date, expiry_date, validity_days, language, notes,
                   rfp_id, bond_type, status, approval_level, requester_name, recipient_name, created_by, company_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'BID_BOND','PENDING',0,$15,$16,$17,$18)""",
            *values, rfp_id, current_user.full_name, office, current_user.user_id, company_id)
    return await _payload(conn, rfp_id, company_id, spec)


@router.delete("/{module}/{rfp_id:int}/bid-bond")
async def delete_bid_bond(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    spec = MODULES[module]
    company_id = require_company(current_user)
    await _context(conn, rfp_id, company_id, spec)
    bond = await fetch_one(conn,
        "SELECT bond_id, approval_level FROM opportunity_bonds WHERE rfp_id=$1 AND company_id=$2", rfp_id, company_id)
    if not bond:
        raise HTTPException(status_code=404, detail=f"No bid bond for this {spec.noun}")
    if (bond["approval_level"] or 0) > 0:
        raise HTTPException(status_code=400, detail="This bid bond is already being approved, so it can't be deleted")
    await execute(conn, "DELETE FROM opportunity_bonds WHERE bond_id=$1 AND company_id=$2", bond["bond_id"], company_id)
    return {"message": "Bid bond request deleted"}
