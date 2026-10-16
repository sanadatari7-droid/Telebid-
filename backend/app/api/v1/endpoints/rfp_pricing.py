"""Sub-module D of Modules 2–4 — pricing approval for a bid.

How the business runs it (Module 1 / C, "Approvals"):
- Pricing goes straight to the VP Sales (Level 1), the person assigned in Company Settings.
- If the figures are beyond the VP's limit, the VP gets approval from a higher level (Level 2).
  ICT is judged on margin (cost vs selling price): the VP approves margins of at least the limit.
  Telecom and EXPRO are judged on discount (list vs offered price): the VP approves discounts up to the limit.
  An EBITDA below the company minimum also needs the higher level.
- The approver whose turn it is gets an email. Any approver may send the pricing back with a reason;
  changing the figures restarts the cycle. The bid manager is told the outcome.
"""
import html
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_db, fetch_one, execute, require_company
from app.middleware.auth import get_current_user
from app.api.v1.endpoints.company_config import get_pricing_config
from app.api.v1.endpoints.rfps import Module, require_rfp
from app.api.v1.endpoints.rfp_checklist import _tell_bid_manager
from app.services.email_service import send_email, smtp_configured

from app.services.plan import module_enabled

router = APIRouter(prefix="/rfps", tags=["RFP pricing approval"], dependencies=[Depends(module_enabled)])

# Besides the person assigned to a level (matched by email), these roles may approve.
APPROVER_ROLES = ("ADMIN", "DEPT_MANAGER", "DIRECTOR")
FIGURES = ("cost", "price", "list_price", "ebitda_pct")


class PricingIn(BaseModel):
    cost: Optional[float] = Field(None, ge=0)           # ICT: total cost
    price: float = Field(..., gt=0)                     # ICT: selling price · Telecom/EXPRO: offered price
    list_price: Optional[float] = Field(None, gt=0)     # Telecom/EXPRO: price before discount
    ebitda_pct: Optional[float] = Field(None, ge=-100, le=100)
    notes: Optional[str] = Field(None, max_length=2000)


class ApproveIn(BaseModel):
    level: int = Field(..., ge=1, le=2)


class SendBackIn(BaseModel):
    note: str = Field(..., min_length=1, max_length=1000)


def _basis(module: Module) -> str:
    return "MARGIN" if module == Module.ict else "DISCOUNT"


def _num(v) -> Optional[Decimal]:
    return None if v is None else Decimal(str(v))


def assess(basis: str, cost, price, list_price, ebitda, cfg: dict) -> dict:
    """The margin or discount, and whether the VP alone (1) or the higher level too (2) must approve."""
    price, cost, list_price, ebitda = _num(price), _num(cost), _num(list_price), _num(ebitda)
    vp = cfg["l1_title"]
    if basis == "MARGIN":
        pct = ((price - cost) / price * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        limit = _num(cfg.get("ict_l1_min_margin"))
        within = limit is None or pct >= limit
        reason = (f"Margin {pct}% — no limit is set, so the {vp} approves" if limit is None
                  else f"Margin {pct}% is at least the {vp}'s minimum of {limit}%" if within
                  else f"Margin {pct}% is below the {vp}'s minimum of {limit}%")
    else:
        pct = ((list_price - price) / list_price * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        limit = _num(cfg.get("telecom_l1_max_discount"))
        within = limit is None or pct <= limit
        reason = (f"Discount {pct}% — no limit is set, so the {vp} approves" if limit is None
                  else f"Discount {pct}% is within the {vp}'s limit of {limit}%" if within
                  else f"Discount {pct}% is above the {vp}'s limit of {limit}%")
    reasons = [reason]
    level = 1 if within else 2
    emin = _num(cfg.get("ebitda_min_pct"))
    if emin is not None and ebitda is not None and ebitda < emin:
        level = 2; reasons.append(f"EBITDA {ebitda}% is below the company minimum of {emin}%")
    if level == 2:
        reasons.append(f"The {vp} approves first, then gets approval from {cfg['l2_title']}")
    return {"pct": pct, "required_level": level, "reasons": reasons}


def _assigned(cfg: dict, level: int, email: Optional[str]) -> bool:
    listed = cfg.get(f"l{level}_email") or ""
    return bool(email) and email.strip().lower() in [e.strip().lower() for e in listed.split(",") if e.strip()]


def _may_approve(cfg: dict, level: int, current_user) -> bool:
    return current_user.has_role(*APPROVER_ROLES) or _assigned(cfg, level, current_user.email)


async def _email_approver(conn, rfp_id: int, company_id: int, cfg: dict, level: int):
    """Tell the person assigned to this level that the pricing is waiting for them."""
    to = cfg.get(f"l{level}_email")
    if not to or not await smtp_configured(company_id):
        return
    p = await fetch_one(conn, """
        SELECT r.rfp_number, r.rfp_title, r.sow, c.name_en, pr.basis, pr.pct, pr.price, pr.cost, pr.list_price,
               pr.ebitda_pct, pr.notes, pr.submitted_by_name, cur.currency_code
        FROM rfps r JOIN clients c ON c.client_id = r.client_id JOIN rfp_pricing pr ON pr.rfp_id = r.rfp_id
        JOIN companies co ON co.company_id = r.company_id LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        WHERE r.rfp_id=$1""", rfp_id)
    cur = p["currency_code"] or ""
    money = lambda v: f"{cur} {Decimal(v):,.2f}".strip()
    lines = [f"Pricing for {p['rfp_number']} — {p['name_en']}" + (f" — {p['rfp_title'] or p['sow']}" if (p['rfp_title'] or p['sow']) else ""),
             f"Submitted by {p['submitted_by_name']}"]
    if p["basis"] == "MARGIN":
        lines += [f"Cost: {money(p['cost'])}", f"Selling price: {money(p['price'])}", f"Margin: {p['pct']}%"]
    else:
        lines += [f"List price: {money(p['list_price'])}", f"Offered price: {money(p['price'])}", f"Discount: {p['pct']}%"]
    if p["ebitda_pct"] is not None:
        lines.append(f"EBITDA: {p['ebitda_pct']}%")
    if p["notes"]:
        lines.append(f"Notes: {p['notes']}")
    lines.append(f"Please review and approve it in TeleBid (bid {p['rfp_number']}, tab D · Pricing).")
    subject = f"{p['rfp_number']}: pricing waiting for your approval ({cfg[f'l{level}_title']})"
    await send_email(to, subject, "".join(f"<p>{html.escape(l)}</p>" for l in lines), "\n".join(lines), company_id)


async def _payload(conn, module: Module, rfp_id: int, current_user) -> dict:
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    cfg = await get_pricing_config(conn, company_id)
    rfp = await fetch_one(conn, """
        SELECT r.tcv, e.ebitda_pct AS eval_ebitda, cur.currency_code, COALESCE(co.currency_decimals, 2) AS decimals
        FROM rfps r JOIN companies co ON co.company_id = r.company_id
        LEFT JOIN currencies cur ON cur.currency_id = co.currency_id
        LEFT JOIN rfp_evaluations e ON e.rfp_id = r.rfp_id
        WHERE r.rfp_id=$1""", rfp_id)
    return {
        "basis": _basis(module),
        "pricing": await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id),
        "config": {k: cfg[k] for k in ("l1_title", "l1_name", "l1_email", "l2_title", "l2_name", "l2_email",
                                        "telecom_l1_max_discount", "ict_l1_min_margin", "ebitda_min_pct")},
        "defaults": {"price": rfp["tcv"], "ebitda_pct": rfp["eval_ebitda"]},
        "currency": {"code": rfp["currency_code"], "decimals": rfp["decimals"]},
        "can_approve": [_may_approve(cfg, 1, current_user), _may_approve(cfg, 2, current_user)],
    }


@router.get("/{module}/{rfp_id:int}/pricing")
async def get_pricing(module: Module, rfp_id: int, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await _payload(conn, module, rfp_id, current_user)


@router.put("/{module}/{rfp_id:int}/pricing")
async def save_pricing(module: Module, rfp_id: int, body: PricingIn, conn=Depends(get_db),
                       current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    basis = _basis(module)
    if basis == "MARGIN":
        if body.cost is None:
            raise HTTPException(status_code=400, detail="Enter the total cost")
        list_price, cost = None, body.cost
    else:
        if body.list_price is None:
            raise HTTPException(status_code=400, detail="Enter the list price (the price before discount)")
        if body.price > body.list_price:
            raise HTTPException(status_code=400, detail="The offered price can't be more than the list price")
        list_price, cost = body.list_price, None

    cfg = await get_pricing_config(conn, company_id)
    result = assess(basis, cost, body.price, list_price, body.ebitda_pct, cfg)
    notes = (body.notes or "").strip() or None
    old = await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id)
    new = {"cost": cost, "price": body.price, "list_price": list_price, "ebitda_pct": body.ebitda_pct}
    # Sent back: saving again resubmits it, even with the same figures.
    changed = not old or old["status"] == "SENT_BACK" or any(_num(old[k]) != _num(new[k]) for k in FIGURES)

    if changed:
        # New or different figures: the cycle starts again from the VP Sales.
        await execute(conn, """
            INSERT INTO rfp_pricing (rfp_id, basis, cost, price, list_price, ebitda_pct, pct, required_level, notes,
                   status, approval_level, submitted_by, submitted_by_name, submitted_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',0,$10,$11,NOW(),NOW())
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
        await _email_approver(conn, rfp_id, company_id, cfg, 1)
        label = "margin" if basis == "MARGIN" else "discount"
        await _tell_bid_manager(conn, rfp_id, company_id, "pricing waiting for approval",
            [f"{current_user.full_name} submitted pricing for approval: {label} {result['pct']}%.", *result["reasons"]],
            "RFP_PRICING")
    else:
        await execute(conn, "UPDATE rfp_pricing SET notes=$2, updated_at=NOW() WHERE rfp_id=$1", rfp_id, notes)
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/pricing/approve")
async def approve_pricing(module: Module, rfp_id: int, body: ApproveIn, conn=Depends(get_db),
                          current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    cfg = await get_pricing_config(conn, company_id)
    lvl = body.level
    if not _may_approve(cfg, lvl, current_user):
        raise HTTPException(status_code=403, detail=f"Only the {cfg[f'l{lvl}_title']} can approve this step")
    row = await fetch_one(conn, "SELECT * FROM rfp_pricing WHERE rfp_id=$1", rfp_id)
    if not row:
        raise HTTPException(status_code=400, detail="No pricing has been submitted yet")
    if row["status"] != "PENDING" or row["approval_level"] != lvl - 1 or lvl > row["required_level"]:
        raise HTTPException(status_code=400, detail=f"This pricing isn't waiting for {cfg[f'l{lvl}_title']} approval")
    done = lvl == row["required_level"]
    result = await execute(conn, f"""
        UPDATE rfp_pricing SET approval_level=$2, l{lvl}_approved_by=$3, l{lvl}_approver_name=$4, l{lvl}_approved_at=NOW(),
               status=$5, updated_at=NOW()
        WHERE rfp_id=$1 AND status='PENDING' AND approval_level=$6""",
        rfp_id, lvl, current_user.user_id, current_user.full_name, "APPROVED" if done else "PENDING", lvl - 1)
    if result == "UPDATE 0":
        raise HTTPException(status_code=409, detail="Someone else just recorded this approval — refresh and try again")
    if done:
        names = [f"{cfg[f'l{i}_title']}: {current_user.full_name if i == lvl else row[f'l{i}_approver_name']}"
                 for i in range(1, lvl + 1)]
        await _tell_bid_manager(conn, rfp_id, company_id, "pricing approved",
                                ["The pricing is fully approved.", *names], "RFP_PRICING")
    else:
        await _email_approver(conn, rfp_id, company_id, cfg, lvl + 1)
    return await _payload(conn, module, rfp_id, current_user)


@router.post("/{module}/{rfp_id:int}/pricing/send-back")
async def send_back_pricing(module: Module, rfp_id: int, body: SendBackIn, conn=Depends(get_db),
                            current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await require_rfp(conn, module, rfp_id, company_id)
    cfg = await get_pricing_config(conn, company_id)
    if not (_may_approve(cfg, 1, current_user) or _may_approve(cfg, 2, current_user)):
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
