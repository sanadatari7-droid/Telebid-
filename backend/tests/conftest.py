"""Shared pytest fixtures for the backend test suite.

Tests run against a real, throwaway Postgres database (telebid_test) rather
than mocks — this codebase has no ORM, every endpoint is hand-written SQL
against asyncpg, so the only test that actually proves an endpoint's query
is correct is one that runs it against real Postgres.

Isolation: each test gets its own connection wrapped in a transaction that
is rolled back afterward (`db_conn` fixture), and the app's `get_db`
dependency is overridden to hand out that same connection, so anything a
test creates through the API never leaks into the next test. The database
itself is (re)built once per test session by applying database/schema.sql
verbatim, so it always reflects the exact same schema the app runs on.
"""
import os
import sys
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

TEST_DB_NAME = "telebid_test"
ADMIN_DSN = "postgresql://telebid:telebid123@localhost:5432/postgres"
TEST_DSN = f"postgresql://telebid:telebid123@localhost:5432/{TEST_DB_NAME}"

# Must be set before app.core.config.Settings() is instantiated (module import
# time), so this runs before any `app.*` import below. Also force AI features
# off so their "not configured" behavior is deterministic in tests regardless
# of what the developer's real backend/.env has set.
os.environ["DATABASE_URL"] = TEST_DSN
os.environ["ANTHROPIC_API_KEY"] = ""

SCHEMA_PATH = BACKEND_ROOT.parent / "database" / "schema.sql"


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _test_database():
    admin_conn = await asyncpg.connect(dsn=ADMIN_DSN)
    try:
        await admin_conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"')
        await admin_conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    finally:
        await admin_conn.close()

    schema_sql = SCHEMA_PATH.read_text()
    conn = await asyncpg.connect(dsn=TEST_DSN)
    try:
        # Simple query protocol (no bind params) accepts a whole multi-statement
        # script in one call — same trick backend/scripts/apply_schema.py uses.
        await conn.execute(schema_sql)
    finally:
        await conn.close()

    from app.db import postgres
    await postgres.init_pool()
    yield
    await postgres.close_pool()


@pytest_asyncio.fixture
async def db_conn():
    """A connection wrapped in a transaction that's rolled back after the
    test — anything the test writes through the app never persists."""
    from app.db import postgres
    conn = await postgres.pool.acquire()
    tx = conn.transaction()
    await tx.start()
    try:
        yield conn
    finally:
        await tx.rollback()
        await postgres.pool.release(conn)


@pytest_asyncio.fixture
async def client(db_conn):
    """An httpx AsyncClient wired to the real FastAPI app, with get_db
    overridden to hand out the single per-test transactional connection."""
    from app.db.postgres import get_db
    from app.main import app

    async def _override_get_db():
        yield db_conn

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


async def _signup_tenant(client, label: str) -> dict:
    """Signs up a fresh company + admin user via the real /auth/signup
    endpoint (which logs the admin in immediately) and returns
    {company_id, headers, username, password, email}."""
    import uuid

    suffix = uuid.uuid4().hex[:8]
    payload = {
        "company_name": f"Test Co {label} {suffix}",
        "company_code": f"T{label}{suffix}"[:20],
        "admin_username": f"admin_{label.lower()}_{suffix}",
        "admin_email": f"admin_{label.lower()}_{suffix}@example.com",
        "admin_password": "TestPass@1234",
        "admin_full_name": f"Test Admin {label}",
    }
    r = await client.post("/api/v1/auth/signup", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()

    return {
        "company_id": body["user"]["company_id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
        "username": payload["admin_username"],
        "password": payload["admin_password"],
        "email": payload["admin_email"],
    }


@pytest_asyncio.fixture
async def tenant(client):
    return await _signup_tenant(client, "A")


@pytest_asyncio.fixture
async def tenant_b(client):
    """A second, independent tenant — for cross-tenant isolation tests."""
    return await _signup_tenant(client, "B")
