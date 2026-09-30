"""Signup, login, and account-lockout behavior."""
import pytest


async def test_signup_creates_company_and_logs_in(client):
    r = await client.post("/api/v1/auth/signup", json={
        "company_name": "Acme Telecom", "company_code": "ACME1",
        "admin_username": "acme_admin", "admin_email": "acme_admin@example.com",
        "admin_password": "StrongPass@123", "admin_full_name": "Acme Admin",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["access_token"]
    assert body["user"]["roles"] == ["ADMIN"]
    assert body["user"]["company_name"] == "Acme Telecom"


async def test_signup_rejects_duplicate_company_code(client):
    r = await client.post("/api/v1/auth/signup", json={
        "company_name": "Someone Else", "company_code": "DUPTEST",
        "admin_username": "dup_admin", "admin_email": "dup_admin@example.com",
        "admin_password": "StrongPass@123", "admin_full_name": "Dup Admin",
    })
    assert r.status_code == 201  # first use of DUPTEST succeeds

    r2 = await client.post("/api/v1/auth/signup", json={
        "company_name": "Someone Else Again", "company_code": "DUPTEST",
        "admin_username": "dup_admin2", "admin_email": "dup_admin2@example.com",
        "admin_password": "StrongPass@123", "admin_full_name": "Dup Admin 2",
    })
    assert r2.status_code == 409


async def test_login_wrong_password_rejected(client, tenant):
    r = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": "wrong-password",
    })
    assert r.status_code == 401


async def test_login_unknown_user_rejected(client):
    r = await client.post("/api/v1/auth/login", json={
        "username": "nobody-like-this-exists", "password": "whatever",
    })
    assert r.status_code == 401


async def test_login_locks_account_after_max_failed_attempts(client, tenant):
    from app.core.config import settings

    for _ in range(settings.MAX_FAILED_LOGINS):
        r = await client.post("/api/v1/auth/login", json={
            "username": tenant["username"], "password": "wrong-password",
        })
    assert r.status_code == 403
    assert "locked" in r.json()["detail"].lower()

    # Even the correct password is now rejected until an admin unlocks it.
    r2 = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": tenant["password"],
    })
    assert r2.status_code == 403


async def test_authenticated_endpoint_rejects_missing_token(client):
    r = await client.get("/api/v1/opportunities-v2")
    assert r.status_code in (401, 403)


async def test_authenticated_endpoint_rejects_garbage_token(client):
    r = await client.get("/api/v1/opportunities-v2", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


async def test_refresh_token_cannot_be_used_as_access_token(client, tenant):
    """A refresh token has token_type=refresh; using it where an access
    token is expected must be rejected (see get_current_user's type check)."""
    login = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": tenant["password"],
    })
    refresh_token = login.json()["refresh_token"]
    r = await client.get("/api/v1/opportunities-v2", headers={"Authorization": f"Bearer {refresh_token}"})
    assert r.status_code == 401


async def test_refresh_succeeds_before_password_change(client, tenant):
    login = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": tenant["password"],
    })
    refresh_token = login.json()["refresh_token"]
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200
    assert r.json()["access_token"]


async def test_refresh_token_rejected_after_password_changes(client, tenant, db_conn):
    """A refresh token issued before a password rotation must stop working
    the moment the password actually changes — otherwise a stolen refresh
    token survives the very rotation meant to lock it out."""
    login = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": tenant["password"],
    })
    refresh_token = login.json()["refresh_token"]

    # Simulate a password change (rotation, reset, or admin-forced change)
    # happening after this refresh token was already issued.
    await db_conn.execute(
        "UPDATE users SET password_changed_at = NOW() + INTERVAL '1 second' WHERE username=$1",
        tenant["username"])

    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 401


async def test_refresh_rejected_for_locked_account(client, tenant, db_conn):
    login = await client.post("/api/v1/auth/login", json={
        "username": tenant["username"], "password": tenant["password"],
    })
    refresh_token = login.json()["refresh_token"]

    await db_conn.execute("UPDATE users SET is_locked=TRUE WHERE username=$1", tenant["username"])

    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 401
