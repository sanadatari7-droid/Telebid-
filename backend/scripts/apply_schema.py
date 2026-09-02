#!/usr/bin/env python3
"""
Applies database/schema.sql to whatever DATABASE_URL points at.

Every statement in schema.sql is written idempotently (CREATE TABLE IF NOT
EXISTS, ADD COLUMN IF NOT EXISTS, etc.), so this is safe to run against a
brand-new empty database (bootstraps every table) or an already-up-to-date
one (no-ops). This is what makes a fresh RDS instance usable — RDS has no
docker-entrypoint-initdb.d equivalent, and app/main.py's run_migrations()
only handles tables added after the original schema was written, not the
foundational ones.

Run as a one-off ECS Fargate task (see infra/terraform/modules/ecs) using
the same task definition/image, with the container command overridden to
run this script instead of uvicorn — that way it inherits the same VPC
subnets and security group as the app, so it can reach a private RDS
instance without a bastion host.

Usage:
    python scripts/apply_schema.py
"""
import asyncio
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.core.config import settings  # noqa: E402

SCHEMA_PATH = Path(__file__).resolve().parent.parent.parent / "database" / "schema.sql"


async def main() -> None:
    if not SCHEMA_PATH.exists():
        print(f"schema file not found: {SCHEMA_PATH}", file=sys.stderr)
        sys.exit(1)

    sql = SCHEMA_PATH.read_text()
    print(f"Applying {SCHEMA_PATH} ({len(sql)} bytes) to {settings.DATABASE_URL.split('@')[-1]}...")

    conn = await asyncpg.connect(dsn=settings.DATABASE_URL)
    try:
        # asyncpg's Connection.execute() uses the simple query protocol when
        # called with no bind parameters, which — unlike the extended
        # protocol used for parameterized queries — accepts a script of
        # multiple semicolon-separated statements in one call.
        await conn.execute(sql)
    finally:
        await conn.close()

    print("Schema applied successfully.")


if __name__ == "__main__":
    asyncio.run(main())
