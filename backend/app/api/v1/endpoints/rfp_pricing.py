"""Sub-module D of Modules 2–4 (after C, the checklist) — pricing approval for a bid.

Uses the Pricing Approval Cycle set in Module 1 / Sub-module C:
- ICT bids are judged on margin: cost and selling price give the margin %.
  Level 1 approves margins of at least its minimum, Level 2 at least its minimum, Level 3 anything lower.
- Telecom bids and EXPRO requests are judged on discount: list price and offered price give the discount %.
  Level 1 approves discounts up to its maximum, Level 2 up to its maximum, Level 3 anything higher.
- An EBITDA below the company minimum always goes up to Level 3.
The approvals run in order (L1, then L2, …) up to the level the figures need. Any approver may
send the pricing back; changing the figures restarts the cycle. The bid manager is told the outcome.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_one, execute, require_company
from app.middleware.auth import get_current_user
from app.api.v1.endpoints.company_config import PRICING_DEFAULTS
from app.api.v1.endpoints.rfps import Module, require_rfp
from app.api.v1.endpoints.rfp_checklist import _tell_bid_manager

router = APIRouter(prefix="/rfps", tags=["RFP pricing approval"])

APPROVER_ROLES = ("ADMIN", "DEPT_MANAGER", "DIRECTOR")
FIGURES = ("cost", "price", "list_price", "ebitda_pct")


class PricingIn(BaseModel):
    cost: Optional[float] = Field(None, ge=0)           # ICT: total cost
    price: float = Field(..., gt=0)                     # ICT: selling price · Telecom/EXPRO: offered price
    list_price: Optional[float] = Field(None, gt=0)     # Telecom/EXPRO: price before discount
    ebitda_pct: Optional[float] = Field(None, ge=-100, le=100)
    notes: Optional[str] = Field(None, max_length=2000)


class ApproveIn(BaseModel):
    level: int = Field(..., ge=1, le=3)


class SendBackIn(BaseModel):
    note: str = Field(..., min_length=1, max_length=1000)


def _basis(module: Module) -> str:
    return "MARGIN" if module == Module.ict else "DISCOUNT"


def _pct(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _num(v) -> Optional[Decimal]:
    return None if v is None else Decimal(str(v))


def assess(basis: str, cost, price, list_price, ebitda, cfg: dict) -> dict:
    """Works out the margin or discount and the approval level it needs, with the reasons."""
    price, cost, list_price, ebitda = _num(price), _num(cost), _num(list_price), _num(ebitda)
    reasons = []
    if basis == "MARGIN":
        pct = _pct((price - cost) / price * 100)
        l1, l2 = _num(cfg.get("ict_l1_min_margin")), _num(cfg.get("ict_l2_min_margin"))
        if l1 is not None and pct >= l1:
            level = 1; reasons.append(f"Margin {pct}% is at least Level 1's minimum of {l1}%")
        elif l2 is not None and pct >= l2:
            level = 2; reasons.append(f"Margin {pct}% is below Level 1's minimum" + (f" of {l1}%" if l1 is not None else "")
                                      + f" but at least Level 2's minimum of {l2}%")
        else:
            level = 3; reasons.append(f"Margin {pct}% is below Level 2's minimum" + (f" of {l2}%" if l2 is not None else " (not set)"))
    else:
        pct = _pct((list_price - price) / list_price * 100)
        l1, l2 = _num(cfg.get("telecom_l1_max_discount")), _num(cfg.get("telecom_l2_max_discount"))
        if l1 is not None and pct <= l1:
            level = 1; reasons.append(f"Discount {pct}% is within Level 1's limit of {l1}%")
        elif l2 is not None and pct <= l2:
            level = 2; reasons.append(f"Discount {pct}% is above Level 1's limit" + (f" of {l1}%" if l1 is not None else "")
                                      + f" but within Level 2's limit of {l2}%")
        else:
            level = 3; reasons.append(f"Discount {pct}% is above Level 2's limit" + (f" of {l2}%" if l2 is not None else " (not set)"))
    emin = _num(cfg.get("ebitda_min_pct"))
    if emin is not None and ebitda is not None and ebitda < emin:
        level = 3; reasons.append(f"EBITDA {ebitda}% is below the company minimum of {emin}%, so Level 3 must approve")
    return {"pct": pct, "required_level": level, "reasons": reasons}


async def _config(conn, company_id: int) -> dict:
    row = await fetch_one(conn, "SELECT * FROM company_pricing_approval WHERE company_id=$1", company_id)
    return dict(row) if row else {"company_id": company_id, **PRICING_DEFAULTS}


async def _payload(conn, module: Module, rfp_id: int, current_user) -> dict:
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    cfg = await _config(conn, company_id)
    rfp = await fetch_one(conn, """
        SELECT r.tcv, r.nrc, r.mrc, e.ebitda_pct AS eval_ebitda, cur.currency_code, COALESCE(co.currency_decimals, 2) AS decimals
        FROM rfps r JOIN companies co ON co.company_id = r.company_id
        LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        LEFT JOIN rfp_evaluations e ON e.rfp_id = r.rfp_id
        WHERE r.rfp_id=$1""", rfp_id)
    return {
        "basis": _basis(module),
        "pricing": await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id),
        "config": {k: cfg.get(k) for k in PRICING_DEFAULTS},
        "defaults": {"price": rfp["tcv"], "ebitda_pct": rfp["eval_ebitda"]},
        "currency": {"code": rfp["currency_code"], "decimals": rfp["decimals"]},
        "can_approve": current_user.has_role(*APPROVER_ROLES),
    }


@router.get("/{module}/{rfp_id:int}/pricing")
async def get_pricing(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _payload(conn, module, rfp_id, current_user)


@router.put("/{module}/{rfp_id:int}/pricing")
async def save_pricing(module: Module, rfp_id: int, body: PricingIn, conn=Depends(get_db),
                       current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    spec = await require_rfp(conn, module, rfp_id, company_id)
    basis = _basis(module)
    if basis == "MARGIN":
        if body.cost is None:
            raise HTTPException(status_code=400, detail="Enter the total cost")
        list_price = None
        cost = body.cost
    else:
        if body.list_price is None:
            raise HTTPException(status_code=400, detail="Enter the list price (the price before discount)")
        if body.price > body.list_price:
            raise HTTPException(status_code=400, detail="The offered price can't be more than the list price")
        list_price, cost = body.list_price, None

    cfg = await _config(conn, company_id)
    result = assess(basis, cost, body.price, list_price, body.ebitda_pct, cfg)
    notes = (body.notes or "").strip() or None
    old = await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id)
    new = {"cost": cost, "price": body.price, "list_price": list_price, "ebitda_pct": body.ebitda_pct}
    # Sent back: saving again resubmits it, even with the same figures.
    changed = not old or old["status"] == "SENT_BACK" or any(_num(old[k]) != _num(new[k]) for k in FIGURES)

    if changed:
        # New or different figures: the cycle starts again from Level 1.
        await execute(conn, """
            INSERT INTO rfp_pricing (rfp_id, basis, cost, price, list_price, ebitda_pct, pct, required_level, notes,
                   status, approval_level, l1_approved_by, l1_approver_name, l1_approved_at,
                   l2_approved_by, l2_approver_name, l2_approved_at, l3_approved_by, l3_approver_name, l3_approved_at,
                   sent_back_by_name, sent_back_at, sent_back_note, submitted_by, submitted_by_name, submitted_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
                    NULL,NULL,NULL,$10,$11,NOW(),NOW())
            ON CONFLICT (rfp_id) DO UPDATE SET basis=EXCLUDED.basis, cost=EXCLUDED.cost, price=EXCLUDED.price,
                list_price=EXCLUDED.list_price, ebitda_pct=EXCLUDED.ebitda_pct, pct=EXCLUDED.pct,
                required_level=EXCLUDED.required_level, notes=EXCLUDED.notes, status='PENDING', approval_level=0,
                l1_approved_by=NULL, l1_approver_name=NULL, l1_approved_at=NULL,
                l2_approved_by=NULL, l2_approver_name=NULL, l2_approved_at=NULL,
                l3_approved_by=NULL, l3_approver_name=NULL, l3_approved_at=NULL,
                sent_back_by_name=NULL, sent_back_at=NULL, sent_back_note=NULL,
                submitted_by=EXCLUDED.submitted_by, submitted_by_name=EXCLUDED.submitted_by_name,
                submitted_at=NOW(), updated_at=NOW()""",
            rfp_id, basis, cost, body.price, list_price, body.ebitda_pct, result["pct"], result["required_level"],
            notes, current_user.user_id, current_user.full_name)
        label = "margin" if basis == "MARGIN" else "discount"
        await _tell_bid_manager(conn, rfp_id, company_id, "pricing waiting for approval",
            [f"{current_user.full_name} submitted pricing for approval: {label} {result['pct']}%.",
             *result["reasons"], f"It needs approval up to Level {result['required_level']}."], "RFP_PRICING")
    else:
        await execute(conn, "UPDATE rfp_pricing SET notes=$2, updated_at=NOW() WHERE rfp_id=$1", rfp_id, notes)
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/pricing/approve")
async def approve_pricing(module: Module, rfp_id: int, body: ApproveIn, conn=Depends(get_db),
                          current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    if not current_user.has_role(*APPROVER_ROLES):
        raise HTTPException(status_code=403, detail="You aren't one of the pricing approvers")
    row = await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id)
    if not row:
        raise HTTPException(status_code=400, detail="No pricing has been submitted yet")
    lvl = body.level
    if row["status"] != "PENDING" or row["approval_level"] != lvl - 1 or lvl > row["required_level"]:
        raise HTTPException(status_code=400, detail=f"This pricing isn't waiting for Level {lvl} approval")
    done = lvl == row["required_level"]
    result = await execute(conn, f"""
        UPDATE rfp_pricing SET approval_level=$2, l{lvl}_approved_by=$3, l{lvl}_approver_name=$4, l{lvl}_approved_at=NOW(),
               status=$5, updated_at=NOW()
        WHERE rfp_id=$1 AND status='PENDING' AND approval_level=$6""",
        rfp_id, lvl, current_user.user_id, current_user.full_name, "APPROVED" if done else "PENDING", lvl - 1)
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Someone else just recorded this approval — refresh and try again")
    if done:
        cfg = await _config(conn, company_id)
        names = [f"Level {i} ({cfg[f'l{i}_title']}): {current_user.full_name if i == lvl else row[f'l{i}_approver_name']}"
                 for i in range(1, lvl + 1)]
        await _tell_bid_manager(conn, rfp_id, company_id, "pricing approved",
                                ["The pricing is fully approved.", *names], "RFP_PRICING")
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/pricing/send-back")
async def send_back_pricing(module: Module, rfp_id: int, body: SendBackIn, conn=Depends(get_db),
                            current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    if not current_user.has_role(*APPROVER_ROLES):
        raise HTTPException(status_code=403, detail="You aren't one of the pricing approvers")
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=400, detail="Say why the pricing is being sent back")
    result = await execute(conn, """
        UPDATE rfp_pricing SET status='SENT_BACK', sent_back_by_name=$2, sent_back_at=NOW(), sent_back_note=$3, updated_at=NOW()
        WHERE rfp_id=$1 AND status='PENDING'""", rfp_id, current_user.full_name, note)
    if result == "UPDATE 0":
        raise HTTPException(status_code=400, detail="Only pricing that is waiting for approval can be sent back")
    await _tell_bid_manager(conn, rfp_id, company_id, "pricing sent back",
                            [f"{current_user.full_name} sent the pricing back.", f"Reason: {note}",
                             "Change the figures and submit again."], "RFP_PRICING")
    return await _payload(conn, module, rfp_id, current_user)
