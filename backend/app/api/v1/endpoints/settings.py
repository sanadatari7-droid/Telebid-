from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val
from app.middleware.auth import get_current_user, require_roles, CurrentUser
from pydantic import BaseModel

router = APIRouter(prefix="/settings", tags=["System Settings"])

class SettingUpdate(BaseModel):
    setting_value: str

class DropdownOption(BaseModel):
    dropdown_key: str
    dropdown_label: str
    option_value: str
    option_label: str
    option_label_ar: Optional[str] = None
    sort_order: int = 0

@router.get("")
async def get_settings(category: Optional[str] = None, conn=Depends(get_db),
    current_user=Depends(get_current_user)):
    sql = "SELECT * FROM system_settings WHERE company_id=1"
    args = []
    if category:
        args.append(category)
        sql += f" AND category=${len(args)}"
    sql += " ORDER BY category, setting_key"
    rows = await fetch_all(conn, sql, *args)
    # Hide secret values from non-admins
    for row in rows:
        if row.get("setting_type") == "SECRET" and not current_user.has_role("ADMIN"):
            row["setting_value"] = "***"
    return rows

@router.patch("/{setting_key}")
async def update_setting(setting_key: str, body: SettingUpdate, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    exists = await fetch_one(conn,
        "SELECT setting_id FROM system_settings WHERE setting_key=$1 AND company_id=1", setting_key)
    if not exists:
        raise HTTPException(status_code=404, detail="Setting not found")
    await execute(conn,
        "UPDATE system_settings SET setting_value=$1, updated_by=$2, updated_at=NOW() WHERE setting_key=$3 AND company_id=1",
        body.setting_value, current_user.user_id, setting_key)
    return {"message": "Setting updated"}

@router.get("/dropdowns/{dropdown_key}")
async def get_dropdown(dropdown_key: str, conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn,
        "SELECT * FROM dropdown_configs WHERE dropdown_key=$1 AND company_id=1 AND is_active=TRUE ORDER BY sort_order",
        dropdown_key)

@router.get("/dropdowns")
async def list_dropdowns(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn,
        "SELECT DISTINCT dropdown_key, dropdown_label FROM dropdown_configs WHERE company_id=1 ORDER BY dropdown_key")

@router.post("/dropdowns")
async def add_dropdown_option(body: DropdownOption, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn,
        "INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, option_label_ar, sort_order) VALUES (1,$1,$2,$3,$4,$5,$6)",
        body.dropdown_key, body.dropdown_label, body.option_value, body.option_label,
        body.option_label_ar, body.sort_order)
    return {"message": "Option added"}

@router.delete("/dropdowns/{dropdown_key}/{option_value}")
async def delete_dropdown_option(dropdown_key: str, option_value: str, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn,
        "UPDATE dropdown_configs SET is_active=FALSE WHERE dropdown_key=$1 AND option_value=$2 AND company_id=1",
        dropdown_key, option_value)
    return {"message": "Option removed"}

@router.get("/company")
async def get_company(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_one(conn, "SELECT * FROM companies WHERE company_id=1")

@router.patch("/company")
async def update_company(body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    allowed = ["company_name","company_name_ar","address","city","country","phone","email","website","industry"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.items():
        if k in allowed:
            args.append(v)
            updates.append(f"{k}=${len(args)}")
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    args.append(1)
    await execute(conn, f"UPDATE companies SET {','.join(updates)} WHERE company_id=${len(args)}", *args)
    return {"message": "Company updated"}

@router.get("/bid-modules")
async def get_modules(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT * FROM bid_modules WHERE is_active=TRUE ORDER BY sort_order")

@router.get("/ict-categories")
async def get_ict_categories(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT * FROM ict_categories WHERE is_active=TRUE ORDER BY sort_order")

@router.post("/ict-categories")
async def add_ict_category(body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    await execute(conn,
        "INSERT INTO ict_categories (company_id, cat_code, cat_name, cat_name_ar, description, has_construction) VALUES (1,$1,$2,$3,$4,$5)",
        body["cat_code"], body["cat_name"], body.get("cat_name_ar"), body.get("description"), body.get("has_construction", False))
    return {"message": "ICT category added"}

@router.post("/test-email")
async def test_email(body: dict, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    from app.services.email_service import send_email
    recipient = body.get("email") or current_user.email
    if not recipient:
        raise HTTPException(status_code=400, detail="No recipient email")
    ok = await send_email(recipient, "TeleBid Enterprise — SMTP Test",
        "<h2>✅ SMTP Working!</h2><p>Your email configuration is working correctly.</p>",
        "SMTP Test successful.")
    if ok: return {"message": f"Test email sent to {recipient}"}
    raise HTTPException(status_code=500, detail="Failed to send test email — check SMTP settings")
