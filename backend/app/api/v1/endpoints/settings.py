from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List
from app.db.postgres import get_db, fetch_all, fetch_one, execute, fetch_val, require_company
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
    company_id = require_company(current_user)
    if category == "EMAIL":
        await ensure_email_settings(conn, company_id)
    sql = "SELECT * FROM system_settings WHERE company_id=$1"
    args = [company_id]
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
    company_id = require_company(current_user)
    exists = await fetch_one(conn,
        "SELECT setting_id FROM system_settings WHERE setting_key=$1 AND company_id=$2", setting_key, company_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Setting not found")
    await execute(conn,
        "UPDATE system_settings SET setting_value=$1, updated_by=$2, updated_at=NOW() WHERE setting_key=$3 AND company_id=$4",
        body.setting_value, current_user.user_id, setting_key, company_id)
    return {"message": "Setting updated"}

@router.get("/dropdowns/{dropdown_key}")
async def get_dropdown(dropdown_key: str, conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn,
        "SELECT * FROM dropdown_configs WHERE dropdown_key=$1 AND company_id=$2 AND is_active=TRUE ORDER BY sort_order",
        dropdown_key, company_id)

@router.get("/dropdowns")
async def list_dropdowns(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn,
        "SELECT DISTINCT dropdown_key, dropdown_label FROM dropdown_configs WHERE company_id=$1 ORDER BY dropdown_key", company_id)

@router.post("/dropdowns")
async def add_dropdown_option(body: DropdownOption, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await execute(conn,
        "INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, option_label_ar, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        company_id, body.dropdown_key, body.dropdown_label, body.option_value, body.option_label,
        body.option_label_ar, body.sort_order)
    return {"message": "Option added"}

@router.delete("/dropdowns/{dropdown_key}/{option_value}")
async def delete_dropdown_option(dropdown_key: str, option_value: str, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await execute(conn,
        "UPDATE dropdown_configs SET is_active=FALSE WHERE dropdown_key=$1 AND option_value=$2 AND company_id=$3",
        dropdown_key, option_value, company_id)
    return {"message": "Option removed"}

@router.get("/company")
async def get_company(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_one(conn, "SELECT * FROM companies WHERE company_id=$1", company_id)

@router.patch("/company")
async def update_company(body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    allowed = ["company_name","company_name_ar","address","city","country","phone","email","website","industry"]
    updates = ["updated_at=NOW()"]
    args = []
    for k, v in body.items():
        if k in allowed:
            args.append(v)
            updates.append(f"{k}=${len(args)}")
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    args.append(company_id)
    await execute(conn, f"UPDATE companies SET {','.join(updates)} WHERE company_id=${len(args)}", *args)
    return {"message": "Company updated"}

@router.get("/bid-modules")
async def get_modules(conn=Depends(get_db), current_user=Depends(get_current_user)):
    return await fetch_all(conn, "SELECT * FROM bid_modules WHERE is_active=TRUE ORDER BY sort_order")

@router.get("/ict-categories")
async def get_ict_categories(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    return await fetch_all(conn, "SELECT * FROM ict_categories WHERE is_active=TRUE AND company_id=$1 ORDER BY sort_order", company_id)

@router.post("/ict-categories")
async def add_ict_category(body: dict, conn=Depends(get_db),
    current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await execute(conn,
        "INSERT INTO ict_categories (company_id, cat_code, cat_name, cat_name_ar, description, has_construction) VALUES ($1,$2,$3,$4,$5,$6)",
        company_id, body["cat_code"], body["cat_name"], body.get("cat_name_ar"), body.get("description"), body.get("has_construction", False))
    return {"message": "ICT category added"}

# ── Email: on/off switch and connection status ────────────────────────────────
EMAIL_DEFAULTS = [
    ("smtp_host", "", "TEXT", "SMTP Host"),
    ("smtp_port", "587", "TEXT", "SMTP Port"),
    ("smtp_user", "", "TEXT", "SMTP Username"),
    ("smtp_password", "", "SECRET", "SMTP Password"),
    ("smtp_from_name", "TeleBid Enterprise", "TEXT", "From Name"),
    ("smtp_from_email", "", "TEXT", "From Email"),
    ("smtp_use_tls", "true", "BOOL", "Use TLS"),
    ("email_enabled", "false", "BOOL", "Enable Email"),
]

async def ensure_email_settings(conn, company_id: int):
    """Every company gets its own email settings to fill in."""
    for key, value, kind, label in EMAIL_DEFAULTS:
        await execute(conn, """
            INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label)
            VALUES ($1,$2,$3,$4,'EMAIL',$5) ON CONFLICT (company_id, setting_key) DO NOTHING""",
            company_id, key, value, kind, label)

async def _set(conn, company_id: int, key: str, value: str, user_id: int):
    await execute(conn, """
        INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label, updated_by, updated_at)
        VALUES ($1,$2,$3,'TEXT','EMAIL_STATUS',$2,$4,NOW())
        ON CONFLICT (company_id, setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,
            updated_by=EXCLUDED.updated_by, updated_at=NOW()""", company_id, key, value, user_id)

async def _email_status(conn, company_id: int) -> dict:
    from app.services.email_service import _get_smtp_config
    smtp = await _get_smtp_config(company_id)
    rows = {r["setting_key"]: r for r in await fetch_all(conn, """
        SELECT setting_key, setting_value, updated_at FROM system_settings
        WHERE company_id=$1 AND setting_key IN ('email_check_ok','email_check_error','email_check_host')""", company_id)}
    configured = bool(smtp["host"] and smtp["user"])
    checked = rows.get("email_check_ok")
    # A check only counts for the server it was made against.
    same_server = checked and rows.get("email_check_host", {}).get("setting_value") == f"{smtp['host']}:{smtp['port']}:{smtp['user']}"
    return {
        "enabled": smtp["enabled"], "configured": configured, "server_wide": configured and not smtp["own"],
        "host": smtp["host"] or None, "port": smtp["port"], "from_email": smtp["from_email"] or smtp["user"] or None,
        "connected": (checked["setting_value"] == "true") if same_server else None,
        "error": rows["email_check_error"]["setting_value"] or None if same_server and "email_check_error" in rows else None,
        "checked_at": checked["updated_at"] if same_server else None,
    }

async def _record_check(conn, company_id: int, result: dict, user_id: int):
    from app.services.email_service import _get_smtp_config
    smtp = await _get_smtp_config(company_id)
    await _set(conn, company_id, "email_check_ok", "true" if result["connected"] else "false", user_id)
    await _set(conn, company_id, "email_check_error", result["error"] or "", user_id)
    await _set(conn, company_id, "email_check_host", f"{smtp['host']}:{smtp['port']}:{smtp['user']}", user_id)

class EmailSwitch(BaseModel):
    enabled: bool

@router.get("/email-status")
async def email_status(conn=Depends(get_db), current_user=Depends(get_current_user)):
    company_id = require_company(current_user)
    await ensure_email_settings(conn, company_id)
    return await _email_status(conn, company_id)

@router.put("/email-enabled")
async def set_email_enabled(body: EmailSwitch, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    company_id = require_company(current_user)
    await ensure_email_settings(conn, company_id)
    await execute(conn, """UPDATE system_settings SET setting_value=$1, updated_by=$2, updated_at=NOW()
                           WHERE company_id=$3 AND setting_key='email_enabled'""",
                  "true" if body.enabled else "false", current_user.user_id, company_id)
    return await _email_status(conn, company_id)

@router.post("/email-check")
async def email_check(conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    """Connects and signs in to the mail server (nothing is sent) and remembers the result."""
    from app.services.email_service import check_smtp
    company_id = require_company(current_user)
    result = await check_smtp(company_id)
    await _record_check(conn, company_id, result, current_user.user_id)
    return await _email_status(conn, company_id)

@router.post("/test-email")
async def test_email(body: dict, conn=Depends(get_db), current_user=Depends(require_roles("ADMIN"))):
    from app.services.email_service import send_email, _get_smtp_config
    company_id = require_company(current_user)
    recipient = body.get("email") or current_user.email
    if not recipient:
        raise HTTPException(status_code=400, detail="No recipient email")
    smtp = await _get_smtp_config(company_id)
    if not (smtp["host"] and smtp["user"]):
        raise HTTPException(status_code=400, detail="Fill in the SMTP host and username first")
    if not smtp["enabled"]:
        raise HTTPException(status_code=400, detail="Email sending is switched off — turn it on first")
    ok = await send_email(recipient, "TeleBid Enterprise — SMTP Test",
        "<h2>✅ SMTP Working!</h2><p>Your email configuration is working correctly.</p>",
        "SMTP Test successful.", company_id=company_id)
    await _record_check(conn, company_id, {"connected": ok, "error": None if ok else "The test email couldn't be sent — check the settings below"}, current_user.user_id)
    if ok: return {"message": f"Test email sent to {recipient}"}
    raise HTTPException(status_code=500, detail="Failed to send test email — check SMTP settings")
