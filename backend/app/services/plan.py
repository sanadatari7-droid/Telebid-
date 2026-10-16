"""What a company has signed up for (the registration window).

- Company type decides the bid modules it sees:
    Telecom → Bid ICT, Bid Telecom and EXPRO
    ICT     → Bid ICT only
    not chosen yet → none (only Company Settings)
- Number of users: how many active users the company pays for each month.
"""
from typing import Optional

from fastapi import Depends, HTTPException

from app.core.config import settings
from app.db.postgres import get_db, fetch_one, fetch_val, require_company
from app.middleware.auth import get_current_user

MODULE_NAMES = {"ict": "Bid ICT", "telecom": "Bid Telecom", "expro": "EXPRO"}


def company_type(row) -> Optional[str]:
    if not row:
        return None
    if row["services_telecom"]:
        return "TELECOM"
    if row["services_ict"]:
        return "ICT"
    return None


def modules_for(ctype: Optional[str]) -> list:
    return {"TELECOM": ["ict", "telecom", "expro"], "ICT": ["ict"]}.get(ctype, [])


async def enabled_modules(conn, company_id: int) -> list:
    row = await fetch_one(conn, "SELECT services_ict, services_telecom FROM companies WHERE company_id=$1", company_id)
    return modules_for(company_type(row))


async def module_enabled(module: str, conn=Depends(get_db), current_user=Depends(get_current_user)):
    """Router dependency for /rfps/{module}/…: a module outside the company type is not available."""
    row = await fetch_one(conn, "SELECT services_ict, services_telecom FROM companies WHERE company_id=$1",
                          require_company(current_user))
    ctype = company_type(row)
    if module in MODULE_NAMES and module not in modules_for(ctype):
        if ctype is None:
            raise HTTPException(status_code=403,
                detail="Choose your company type (Telecom or ICT) in Company Settings → Company Profile first")
        raise HTTPException(status_code=403,
            detail=f"{MODULE_NAMES[module]} is only for Telecom companies — your company type is ICT")


def price_per_user() -> Optional[float]:
    return settings.PRICE_PER_USER_MONTHLY


async def seats(conn, company_id: int) -> dict:
    row = await fetch_one(conn, """
        SELECT c.licensed_users,
               (SELECT COUNT(*) FROM users u WHERE u.company_id=c.company_id AND u.is_active) AS active_users
        FROM companies c WHERE c.company_id=$1""", company_id)
    price = price_per_user()
    licensed = row["licensed_users"] if row else None
    return {
        "licensed_users": licensed,
        "active_users": row["active_users"] if row else 0,
        "price_per_user": price,
        "currency": settings.BILLING_CURRENCY,
        "monthly_total": round(price * licensed, 2) if price is not None and licensed else None,
    }


async def require_free_seat(conn, company_id: int):
    """Adding or re-activating a user needs a free seat; companies without a set number aren't limited."""
    s = await seats(conn, company_id)
    if s["licensed_users"] is not None and s["active_users"] >= s["licensed_users"]:
        raise HTTPException(status_code=400,
            detail=f"All {s['licensed_users']} users in your subscription are in use. "
                   f"Increase the number of users in Company Settings → Users & Subscription, or deactivate a user first.")
