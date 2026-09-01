import asyncpg
from typing import Optional, List, Dict, Any
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)
pool: Optional[asyncpg.Pool] = None

async def init_pool():
    global pool
    logger.info(f"Connecting to PostgreSQL: {settings.DATABASE_URL[:40]}...")
    try:
        pool = await asyncpg.create_pool(
            dsn=settings.DATABASE_URL,
            min_size=2,
            max_size=20,
            command_timeout=30,
            server_settings={"application_name": "telebid-api"}
        )
        # Test connection
        async with pool.acquire() as conn:
            version = await conn.fetchval("SELECT version()")
            logger.info(f"✅ PostgreSQL connected: {version[:40]}")
    except Exception as e:
        logger.error(f"❌ PostgreSQL connection failed: {e}")
        raise

async def close_pool():
    global pool
    if pool:
        await pool.close()
        logger.info("PostgreSQL pool closed")

async def get_db():
    if pool is None:
        raise RuntimeError("Database pool not initialized. Check DATABASE_URL and PostgreSQL connection.")
    async with pool.acquire() as conn:
        yield conn

async def fetch_one(conn, sql: str, *args) -> Optional[Dict]:
    row = await conn.fetchrow(sql, *args)
    return dict(row) if row else None

async def fetch_all(conn, sql: str, *args) -> List[Dict]:
    rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]

async def fetch_val(conn, sql: str, *args):
    return await conn.fetchval(sql, *args)

async def execute(conn, sql: str, *args) -> str:
    return await conn.execute(sql, *args)

async def fetch_page(conn, sql: str, args: list, page: int, page_size: int) -> Dict:
    offset = (page - 1) * page_size
    count_sql = f"SELECT COUNT(*) FROM ({sql}) AS _c"
    total = await fetch_val(conn, count_sql, *args) or 0
    paged_sql = f"{sql} LIMIT ${len(args)+1} OFFSET ${len(args)+2}"
    rows = await fetch_all(conn, paged_sql, *args, page_size, offset)
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size)
    }

async def get_raw_connection():
    import asyncpg
    from app.core.config import settings
    return await asyncpg.connect(settings.DATABASE_URL)
