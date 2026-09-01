from fastapi import APIRouter, Depends, HTTPException, Request
from app.db.postgres import get_db, fetch_one, execute, fetch_val
from app.core.security import (
    verify_password, create_access_token, create_refresh_token,
    generate_otp_secret, generate_totp, decode_token, hash_password
)
from app.core.config import settings
from app.middleware.auth import require_roles, CurrentUser
from pydantic import BaseModel
from typing import Optional
import secrets, re

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class OTPVerify(BaseModel):
    session_token: str
    otp_code: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    job_title: str = ""


class TenantSignupRequest(BaseModel):
    company_name: str
    company_code: str
    admin_username: str
    admin_email: str
    admin_password: str
    admin_full_name: str


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, conn=Depends(get_db)):
    user = await fetch_one(conn, """
        SELECT user_id, username, email, full_name, password_hash,
               is_active, is_locked, failed_attempts, otp_secret, otp_enabled, company_id
        FROM users WHERE username=$1 OR email=$1""", body.username)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if user["is_locked"]:
        raise HTTPException(status_code=403, detail="Account is locked. Contact your administrator.")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is inactive. Contact your administrator.")

    if not verify_password(body.password, user["password_hash"]):
        new_attempts = (user["failed_attempts"] or 0) + 1
        await execute(conn,
            "UPDATE users SET failed_attempts=$1 WHERE user_id=$2",
            new_attempts, user["user_id"])
        if new_attempts >= settings.MAX_FAILED_LOGINS:
            await execute(conn, "UPDATE users SET is_locked=TRUE WHERE user_id=$1", user["user_id"])
            raise HTTPException(status_code=403,
                detail=f"Account locked after {settings.MAX_FAILED_LOGINS} failed attempts. Contact administrator.")
        remaining = settings.MAX_FAILED_LOGINS - new_attempts
        raise HTTPException(status_code=401,
            detail=f"Invalid password. {remaining} attempt{'s' if remaining!=1 else ''} remaining.")

    # Reset failed attempts on success
    await execute(conn, "UPDATE users SET failed_attempts=0 WHERE user_id=$1", user["user_id"])

    # ── OTP flow (only if user has otp_enabled=TRUE) ──────────────────────────
    if user["otp_enabled"]:
        otp_secret = user["otp_secret"] or generate_otp_secret()
        if not user["otp_secret"]:
            await execute(conn,
                "UPDATE users SET otp_secret=$1 WHERE user_id=$2", otp_secret, user["user_id"])

        otp_code = generate_totp(otp_secret)
        session_token = secrets.token_hex(32)

        # Store session_token + otp_code in DB
        await execute(conn, """
            INSERT INTO otp_tokens
                (user_id, otp_code, session_token, otp_type, expires_at)
            VALUES ($1, $2, $3, 'LOGIN', NOW() + INTERVAL '10 minutes')""",
            user["user_id"], otp_code, session_token)

        # Try email — show code on screen if SMTP not configured (demo mode)
        email_sent = False
        try:
            from app.services.email_service import send_otp_email
            email_sent = await send_otp_email(user["email"], user["full_name"], otp_code)
        except Exception:
            pass

        resp = {
            "requires_otp": True,
            "session_token": session_token,
            "message": f"OTP sent to {user['email'][:3]}***" if email_sent else "OTP generated (SMTP not configured — see demo_otp below)",
        }
        if not email_sent:
            # Show OTP on screen when email not working — remove in production
            resp["demo_otp"] = otp_code

        return resp

    # ── Direct login (OTP disabled) ───────────────────────────────────────────
    return await _issue_tokens(conn, user)


# ── OTP Verification ──────────────────────────────────────────────────────────

@router.post("/verify-otp")
async def verify_otp(body: OTPVerify, conn=Depends(get_db)):
    # Validate BOTH session_token AND otp_code — session_token prevents replay attacks
    record = await fetch_one(conn, """
        SELECT t.token_id, t.user_id
        FROM otp_tokens t
        WHERE t.session_token = $1
          AND t.otp_code      = $2
          AND t.otp_type      = 'LOGIN'
          AND t.is_used       = FALSE
          AND t.expires_at    > NOW()
        ORDER BY t.created_at DESC
        LIMIT 1""", body.session_token, body.otp_code)

    if not record:
        raise HTTPException(status_code=401,
            detail="Invalid or expired OTP code. Please try again or go back and log in again.")

    # Mark token as used immediately (prevent replay)
    await execute(conn,
        "UPDATE otp_tokens SET is_used=TRUE WHERE token_id=$1",
        record["token_id"])

    user = await fetch_one(conn, "SELECT * FROM users WHERE user_id=$1", record["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return await _issue_tokens(conn, user)


# ── Token helper ──────────────────────────────────────────────────────────────

async def _issue_tokens(conn, user: dict) -> dict:
    uid = user["user_id"]

    # company_id in the JWT is convenience/debugging metadata only — every
    # request re-derives it fresh from the users table (see get_current_user),
    # so a stale claim in an already-issued token can't grant access after a
    # user is moved between companies.
    access_token  = create_access_token({"sub": str(uid), "username": user["username"], "company_id": user.get("company_id")})
    refresh_token = create_refresh_token({"sub": str(uid)})

    await execute(conn, "UPDATE users SET last_login=NOW() WHERE user_id=$1", uid)

    roles_str = await fetch_val(conn, """
        SELECT STRING_AGG(r.role_code, ',')
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = $1""", uid)
    roles = roles_str.split(",") if roles_str else []

    dept = await fetch_one(conn, """
        SELECT d.dept_name FROM departments d
        JOIN users u ON d.dept_id = u.dept_id
        WHERE u.user_id = $1""", uid)

    company = await fetch_one(conn,
        "SELECT c.company_id, c.company_name FROM companies c JOIN users u ON c.company_id=u.company_id WHERE u.user_id=$1",
        uid)

    try:
        await execute(conn, """
            INSERT INTO audit_logs (user_id, username, action, module)
            VALUES ($1, $2, 'LOGIN', 'AUTH')""", uid, user["username"])
    except Exception:
        pass  # Don't fail login if audit log write fails

    return {
        "requires_otp":  False,
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
        "expires_in":    settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "user_id":   uid,
            "username":  user["username"],
            "email":     user["email"],
            "full_name": user["full_name"],
            "job_title": user.get("job_title"),
            "dept_name": dept["dept_name"] if dept else None,
            "roles":     roles,
            "company_id":   company["company_id"] if company else None,
            "company_name": company["company_name"] if company else None,
        }
    }


# ── Refresh Token ─────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_token(body: dict, conn=Depends(get_db)):
    try:
        payload = decode_token(body.get("refresh_token", ""))
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        new_token = create_access_token({"sub": payload["sub"]})
        return {"access_token": new_token, "token_type": "bearer"}
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}


def _validate_password(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r"[0-9]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")


# ── Tenant Signup (public — creates a NEW company) ─────────────────────────────

@router.post("/signup", status_code=201)
async def signup(body: TenantSignupRequest, conn=Depends(get_db)):
    """Creates a brand new company (tenant) plus its first user, who is
    unconditionally that company's ADMIN. This is the only public,
    unauthenticated way to create a company — it replaces the old
    /auth/register, which let anyone join the single existing company and
    made the first user in the WHOLE SYSTEM an admin (meaningless once more
    than one tenant exists). Existing companies invite teammates via the
    authenticated POST /auth/register below instead."""
    _validate_password(body.admin_password)

    existing_company = await fetch_val(conn, "SELECT company_id FROM companies WHERE company_code=$1", body.company_code)
    if existing_company:
        raise HTTPException(status_code=409, detail="Company code already in use")
    existing_user = await fetch_one(conn,
        "SELECT user_id FROM users WHERE username=$1 OR email=$2", body.admin_username, body.admin_email)
    if existing_user:
        raise HTTPException(status_code=409, detail="Username or email already exists")

    pw_hash = hash_password(body.admin_password)
    async with conn.transaction():
        company_id = await fetch_val(conn,
            "INSERT INTO companies (company_code, company_name, is_active) VALUES ($1,$2,TRUE) RETURNING company_id",
            body.company_code, body.company_name)
        uid = await fetch_val(conn, """
            INSERT INTO users (username, email, password_hash, full_name, is_active, otp_enabled, company_id)
            VALUES ($1,$2,$3,$4,TRUE,FALSE,$5) RETURNING user_id""",
            body.admin_username, body.admin_email, pw_hash, body.admin_full_name, company_id)
        role_id = await fetch_val(conn, "SELECT role_id FROM roles WHERE role_code='ADMIN'")
        if role_id:
            await execute(conn, "INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)", uid, role_id)

    try:
        await execute(conn,
            "INSERT INTO audit_logs (user_id, username, action, module, company_id) VALUES ($1,$2,'COMPANY_SIGNUP','AUTH',$3)",
            uid, body.admin_username, company_id)
    except Exception:
        pass

    user = await fetch_one(conn, "SELECT * FROM users WHERE user_id=$1", uid)
    return await _issue_tokens(conn, user)


# ── Register (authenticated — invites a teammate into YOUR company) ───────────

@router.post("/register", status_code=201)
async def register(body: RegisterRequest, conn=Depends(get_db),
                    current_user: CurrentUser = Depends(require_roles("ADMIN"))):
    _validate_password(body.password)

    existing = await fetch_one(conn,
        "SELECT user_id FROM users WHERE username=$1 OR email=$2",
        body.username, body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already exists")

    pw_hash = hash_password(body.password)
    await execute(conn, """
        INSERT INTO users (username, email, password_hash, full_name, job_title, is_active, otp_enabled, company_id)
        VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6)""",
        body.username, body.email, pw_hash, body.full_name, body.job_title, current_user.company_id)

    uid = await fetch_val(conn, "SELECT user_id FROM users WHERE username=$1", body.username)
    # New teammates always land as PROCUREMENT — an admin promotes them
    # explicitly afterwards via User Management, never automatically.
    role_id = await fetch_val(conn, "SELECT role_id FROM roles WHERE role_code='PROCUREMENT'")
    if role_id:
        await execute(conn,
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            uid, role_id)

    try:
        await execute(conn,
            "INSERT INTO audit_logs (user_id, username, action, module, company_id) VALUES ($1,$2,'REGISTER','AUTH',$3)",
            uid, body.username, current_user.company_id)
    except Exception:
        pass

    return {
        "message": "Account created.",
        "username": body.username,
        "role": "PROCUREMENT",
    }
