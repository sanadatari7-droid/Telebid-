# PostgreSQL → Oracle Database Free 23ai Full Cutover — TeleBid Enterprise

> **Status**: Planned, not started. Written up after two codebase surveys and
> reviewed with the project owner. Execution needs a machine with real
> internet access (Docker image pulls) — it was blocked in the cloud sandbox
> this plan was drafted in, which is why it lives here instead of already
> being underway. Pick this up in a Claude Code session on a machine with
> normal Docker/internet access, starting at Phase 0 below.

## Context

TeleBid currently runs entirely on PostgreSQL via asyncpg. After an Oracle
Cloud billing surprise on an unrelated VM, the project owner decided against
Oracle Cloud as a *host* but wants Oracle Database as the app's *database
engine* — a full cutover, no dual-support, targeting Oracle Database Free
23ai self-hosted via Docker (no Oracle Cloud account involved at all).

Two research passes over the codebase (grep-verified, not estimated) establish
the real scope: **66 tables, ~31 backend files, 460+ raw parameterized SQL
statements, zero ORM**. This is a large, multi-week hand-conversion effort, not
a driver swap — Oracle's SQL dialect and driver semantics differ from
PostgreSQL's in ways with no mechanical 1:1 substitution for several constructs
(`RETURNING`, `ON CONFLICT`, array binding, `FILTER`, dynamic interval casts).
The plan below sequences the work to surface mistakes one module at a time
rather than in one big-bang test pass at the end, and is explicit about two
trade-off decisions the project owner should see, not have hidden inside the
diff.

## Two confirmed decisions

1. **Full cutover** — PostgreSQL removed entirely from dev, test, and prod. No
   `DB_ENGINE` toggle.
2. **Target: Oracle Database Free 23ai**, self-hosted via Docker (Oracle's
   own image at `container-registry.oracle.com/database/free:latest`, or the
   community-maintained `gvenzl/oracle-free` on Docker Hub as a fallback if
   Oracle's own registry is unreachable). No Oracle Cloud / Autonomous
   Database.

## Two open technical decisions — recommendation, presented for visibility

- **Booleans**: use Oracle 23ai's native SQL `BOOLEAN` type (added in 23ai,
  not just PL/SQL) instead of `NUMBER(1)`. This leaves all 139 `TRUE`/`FALSE`
  literal occurrences across 25 files untouched and avoids a real semantic-bug
  class (`NUMBER(1)` compared inconsistently against `1`/`'Y'`/etc. across 66
  tables). Verify in Phase 0 that `python-oracledb`'s thin-mode async driver
  round-trips native BOOLEAN as Python `bool` before locking this in.
- **Fuzzy/full-text search** (`pg_trgm` trigram index + `tsvector` full-text
  index + `similarity()` used as a ranking function in the AI content-library
  RAG retrieval, `content_rag.py`): degrade to
  `UPPER(col) LIKE UPPER('%'||:term||'%')` now; defer Oracle Text (`CONTEXT`
  index + `CONTAINS()`) as a fast-follow. **This is a real, user-facing
  quality regression** — search gets less forgiving of typos, and the AI
  advisor's grounding-answer retrieval gets less relevant — accepted in
  exchange for not scope-creeping an already-large migration. Flagged
  explicitly rather than silently degraded; revisit with Oracle Text once the
  cutover is stable if the quality loss matters in practice.

## Phase 0 — Environment & tooling spike (do first, blocks everything else)

- Stand up Oracle Database Free 23ai locally via Docker; confirm the pull/run
  works with no Oracle Cloud account dependency. Try Oracle's own registry
  first; if it's unreachable for any reason, `gvenzl/oracle-free:23-slim` on
  Docker Hub is a well-maintained equivalent.
- Add `oracledb` (≥2.1, pin exact version at implementation time) to
  `backend/requirements.txt` in place of `asyncpg==0.29.0`.
- **Spike the driver architecture question before writing any app code**:
  throwaway script using `oracledb.connect_async`/`create_pool_async`, run
  `SELECT 1 FROM DUAL`, round-trip a native BOOLEAN column, do an explicit
  commit/rollback. Confirm thin-mode async supports an
  `async with pool.acquire() as conn` pattern mirroring asyncpg's. **If it
  doesn't**, the architecture changes to a sync-driver-in-threadpool wrapper —
  materially different, worse concurrency profile, and every later phase's
  shape changes. Do not proceed past this phase until resolved.
- Decide the connection settings shape in `backend/app/core/config.py`:
  replace the single `DATABASE_URL` (Postgres URL) with split
  `ORACLE_USER`/`ORACLE_PASSWORD`/`ORACLE_DSN` settings (Oracle's
  user/password/DSN triple doesn't compress into a URL the way Postgres's
  does).

## Phase 1 — Schema port

Replace `database/schema.sql` with an Oracle DDL version (rename, e.g.
`database/schema_oracle.sql` — the file's own header currently says
"PostgreSQL Schema"). Also port `backend/app/main.py`'s `run_migrations()`
(lines 17-434) — a **second, parallel schema-evolution mechanism** that runs
on every app startup with ~19 more raw-SQL migration strings (two full
`CREATE TABLE` statements for `won_records`/`lost_records`, several `DO $$`
blocks) — easy to miss if only `schema.sql` is considered, verified present.

Conversion, table-by-table (66 tables):
- `SERIAL` → `NUMBER GENERATED BY DEFAULT AS IDENTITY`
- `TEXT` (107) → `CLOB`; `VARCHAR` (279) → `VARCHAR2`; `NUMERIC(p,s)` (47) →
  `NUMBER(p,s)`
- `TIMESTAMPTZ` (98) → `TIMESTAMP WITH TIME ZONE`; `NOW()` (89) →
  `SYSTIMESTAMP`
- `BOOLEAN` (68) → keep native `BOOLEAN` (see decision above)
- Drop `CREATE EXTENSION pg_trgm` and its 3 trigram/GIN/tsvector indexes per
  the fuzzy-search decision; replace with plain b-tree indexes where useful
  for prefix `LIKE`
- `update_updated_at()` plpgsql function + 3 triggers → PL/SQL trigger
  functions using `:NEW.updated_at := SYSTIMESTAMP;`
- `IF NOT EXISTS` idempotency (used pervasively, no Oracle equivalent) →
  **recommend**: let the Python migration runner (Phase 3) catch and swallow
  the specific "already exists" Oracle error codes (ORA-00955, ORA-01430,
  ORA-02260/-01408) per statement, reusing the try/except-per-statement
  pattern `run_migrations()` already trusts, rather than wrapping every DDL
  statement in its own PL/SQL exception-handler block
- The one `DO $$ ... FOREACH t IN ARRAY ... EXECUTE format(...)` loop
  (~lines 1538-1567, backfills `company_id` across ~35 tables) → PL/SQL
  anonymous block with a literal table-name list, `EXECUTE IMMEDIATE` +
  string concatenation in place of `EXECUTE format(...)`
- 25 `ON CONFLICT DO NOTHING` seed upserts → `MERGE INTO ... USING (SELECT
  ... FROM dual) ... WHEN NOT MATCHED THEN INSERT` (no `WHEN MATCHED` needed,
  none of these are true upserts)
- `INTERVAL '30 days'` → Oracle interval literal (`INTERVAL '30' DAY`) or
  `NUMTODSINTERVAL(30,'DAY')`
- For `run_migrations()` specifically: drop its SQL-level `IF NOT
  EXISTS`/`DO $$` guards for the Oracle version and rely on the existing
  per-statement Python exception handling — less code than replicating PL/SQL
  guards

Verify: apply the new DDL to a fresh Oracle Free container via SQL*Plus
directly (before `apply_schema.py` is rewritten) — once for syntax validity,
a second time to prove idempotency (ORA errors caught, not fatal).

## Phase 2 — Core DB layer: `postgres.py` → `oracle.py`

Replace `backend/app/db/postgres.py` with `backend/app/db/oracle.py`. Update
import sites: `backend/app/main.py` and every endpoint file's
`from app.db.postgres import fetch_one, fetch_all, ...`.

- `init_pool()` → `oracledb.create_pool_async(...)`
- `get_db()` → same generator-dependency shape
- `fetch_one`/`fetch_all` → `cursor.execute` + `fetchone`/`fetchall`, zip
  `cursor.description` column names into dicts (oracledb cursors aren't
  dict-like by default the way asyncpg `Record`s are — implement, don't just
  rename)
- `fetch_val` → `cursor.fetchone()[0]`
- **`execute()` → return `cursor.rowcount` (int) instead of asyncpg's
  command-status string** (`"UPDATE 3"`). This ripples into **31 call sites
  across 13 files** that currently check `if result == "UPDATE 0":` /
  `"DELETE 0":` (verified via grep: `users.py`, `bonds.py`,
  `opportunities_v2.py`, `contracts.py`, `vendors.py`, `content_library.py`,
  `expro.py`, `company_config.py`, `employees.py`, `lost_records.py`,
  `ict.py`, `service_categories.py`, `location.py`) — each becomes `== 0`.
  Track as a first-class Phase 5 checklist item, not a footnote.
- `fetch_page()` → rewrite `LIMIT $n OFFSET $n` tail as Oracle 12c+
  `OFFSET :n ROWS FETCH NEXT :n ROWS ONLY`; keep the
  `SELECT COUNT(*) FROM (sql) AS _c` wrapper (works unchanged in Oracle)
- `require_company()` → copy verbatim (pure Python, no SQL)
- `get_raw_connection()` → `oracledb.connect_async(...)`

Standardize the bind convention project-wide before Phase 5: Oracle numbered
positional binds (`:1, :2, :3`) matching asyncpg's `$1,$2,$3` 1:1 — makes the
bulk of ~460 occurrences a mechanical `\$(\d+)` → `:\1` regex first pass per
file, narrowing hand-conversion to the non-mechanical constructs (RETURNING,
ON CONFLICT, ILIKE, array binding, STRING_AGG/FILTER, INTERVAL/NOW/AGE).

## Phase 3 — Migration script: `apply_schema.py`

Edit `backend/scripts/apply_schema.py` in place. Replace the single
`await conn.execute(sql)` (relies on asyncpg's multi-statement simple-query
protocol, no oracledb equivalent) with a real statement splitter: split on
top-level `;`, execute each PL/SQL block (`DECLARE...BEGIN...END;`) as one
`cursor.execute()` call, catch and *log* (not silently swallow) the specific
idempotency ORA codes from Phase 1, re-raise anything else.

## Phase 4 — Test fixtures: `conftest.py`

Edit `backend/tests/conftest.py` in place:
- No lightweight `CREATE DATABASE` in Oracle — replace the admin-DSN
  drop/create with an Oracle **user/schema** create-drop (`DROP USER
  telebid_test CASCADE` / `CREATE USER telebid_test IDENTIFIED BY ...`), then
  apply `schema_oracle.sql` against that user's own schema
- Oracle connections don't have a separate transaction object the way
  asyncpg's `conn.transaction()` does — rewrite `db_conn`'s rollback to
  `await conn.rollback()` directly on the connection
- `client` fixture's `get_db` override needs only the import path updated
  (`from app.db.oracle import get_db`)

Verify: get the simplest existing auth test passing end-to-end against the
new fixtures before Phase 5 — proves container → schema → pool →
transaction-per-test → FastAPI override all work, independent of any endpoint
SQL correctness.

## Phase 5 — Per-file SQL conversion, module-by-module, test-as-you-go

**Do not convert all files then test once.** Convert one file/tightly-coupled
group, run its tests immediately, fix, move on. Order by dependency and risk:

1. **`backend/app/middleware/auth.py`** + **`backend/app/api/v1/endpoints/auth.py`**
   first — every test's tenant fixture (`_signup_tenant`) depends on
   `/auth/signup` working. `auth.py` has the first `RETURNING company_id`/
   `RETURNING user_id` sites (lines 258/262) — establish a small
   `insert_returning(conn, sql, args, out_type)` helper in `oracle.py` here
   using Oracle's `RETURNING ... INTO :out_var` bind-variable pattern, so the
   remaining `RETURNING` sites (`content_library.py`, `excel_import.py`,
   `opportunities_v2.py` ×3) reuse it instead of five ad-hoc implementations.
2. **`users.py`** next (`STRING_AGG`, `ARRAY_AGG` with/without `FILTER` →
   `LISTAGG` + `CASE`-restructured, plus 6 `execute()`-rowcount sites) —
   closely coupled to auth/roles.
3. **Low-risk single-table CRUD files** in small batches of 3-4, not all at
   once: `notifications.py`, `watchlist.py`, `service_categories.py`,
   `location.py`, `lost_records.py`, `employees.py`, `ict.py`, `expro.py`,
   `vendors.py`, `comments.py`, `settings.py`, `scheduler.py`,
   `company_config.py`, `references.py`, `contracts.py`, `bonds.py`,
   `evaluations.py`, `bid_logs.py`, `won_records.py`, `excel_import.py`.
4. **Array-binding + fuzzy-search files**: `content_library.py`
   (`ANY($1::int[])` line 96 → Oracle collection binding, e.g. a dynamic
   `IN (:1,:2,:3...)` expansion since the id list is small/bounded, plus
   `RETURNING *` line 43), `app/services/ai_alert_engine.py`
   (`ANY($4::text[])` line 211, same approach), `app/services/content_rag.py`
   (the `similarity()` degrade per the fuzzy-search decision), `search.py`
   (`ILIKE`, date-interval casts).
5. **`bids.py`** + legacy **`opportunities.py`** together — share the
   `NOW()+INTERVAL '7 days'` deadline pattern repeated identically across
   `bids.py`, `watchlist.py`, `scheduler.py`, `reports.py`, `contracts.py`.
   Extract into one named query-fragment helper while converting rather than
   hand-translating it 8 separate times.
6. **`opportunities_v2.py` last** — largest/highest-risk file (1187 lines, 92
   placeholders, 3 `RETURNING` sites, one genuine `ON CONFLICT (opp_id) DO
   UPDATE SET ... EXCLUDED...` upsert at line 864 requiring a real Oracle
   `MERGE` with both `WHEN MATCHED` and `WHEN NOT MATCHED` — not the simpler
   DO-NOTHING pattern used elsewhere — plus the dynamic interval cast
   `($1||' days')::INTERVAL` at line 1172 → `NUMTODSINTERVAL(:1, 'DAY')`.
   Every pattern it needs has been solved once elsewhere in the codebase by
   the time this file is reached.

Per-module checklist at every step: grep the file clean of `$` placeholders,
`ILIKE`, `NOW()`, `ON CONFLICT`, bare `RETURNING` (no `INTO`), `ANY($n::...[])`;
confirm its pytest module passes; manually exercise at least one endpoint via
the running dev stack as a spot-check beyond automated tests.

## Phase 6 — Docker / deployment

- `docker-compose.yml` + `docker-compose.prod.yml`: replace the
  `postgres:16-alpine` service with Oracle Free. Real differences, not just an
  image-line swap: init files go in `/opt/oracle/scripts/setup/` and
  `/opt/oracle/scripts/startup/` (not `/docker-entrypoint-initdb.d/`); no
  built-in healthcheck (write one probing `SELECT 1 FROM DUAL`); expect a
  1-3+ minute first-boot `start_period` (Oracle Free creates its DB on first
  start, much slower than Postgres); `POSTGRES_PASSWORD` → `ORACLE_PWD`
  (SYS/SYSTEM) + a separately-created app-schema user; volume path becomes
  `/opt/oracle/oradata`. Re-benchmark `docker-compose.prod.yml`'s resource
  limits — Oracle Free's baseline footprint is heavier than
  `postgres:16-alpine`.
- `backend/app/core/config.py`, `.env.example`, `.env.prod.example`: replace
  `DATABASE_URL=postgresql://...` with the Oracle settings from Phase 0.
- `infra/on-premises/scripts/backup.sh`/`restore.sh`: replace `pg_dump`/`psql`
  with Oracle Data Pump (`expdp`/`impdp`) — flag the simpler (but
  cold-backup-only) alternative of a raw `oradata` volume copy to the user
  as a lower-effort option if full point-in-time restorability isn't needed.
- `infra/on-premises/README.md`: update backup/restore section, the
  `ALTER USER ... WITH PASSWORD` secret-rotation instructions (Oracle:
  `ALTER USER <user> IDENTIFIED BY <new password>`), and prose references to
  Postgres/`psql`.

## Verification (end to end)

1. Schema-apply proof: fresh Oracle Free container + `apply_schema.py` once →
   confirm all tables/triggers/seed data; run again → confirm clean idempotent
   no-op.
2. Full pytest suite run against Oracle fixtures, module-by-module as each
   Phase 5 conversion lands (same sequence, tracked together) — auth, tenant
   isolation, opportunities lifecycle, costing math, compliance,
   content-library, AI-alert-engine.
3. Manual golden-path smoke test on the full dev stack (frontend needs no
   changes, REST-only): signup → login → create opportunity → costing →
   approval → won/lost. Run once `opportunities_v2.py` (Phase 5's last file)
   is converted.
4. Explicitly re-test the two flagged trade-off areas as their own checklist
   items: search returns sensible substring matches; AI content-library
   answer-drafting still returns a reasonable (if lower-ranked) result rather
   than erroring.

## Critical files

- `backend/app/db/postgres.py` → new `backend/app/db/oracle.py`
- `database/schema.sql` → new `database/schema_oracle.sql`
- `backend/app/main.py` (the second, easily-missed `run_migrations()`
  schema-evolution path, lines 17-434)
- `backend/scripts/apply_schema.py`, `backend/tests/conftest.py`
- `backend/app/api/v1/endpoints/auth.py` + `backend/app/middleware/auth.py`
  (foundational — convert first)
- `backend/app/api/v1/endpoints/opportunities_v2.py` (largest/highest-risk —
  convert last)
- `docker-compose.yml`, `docker-compose.prod.yml`,
  `backend/app/core/config.py`
- `infra/on-premises/scripts/backup.sh`, `restore.sh`,
  `infra/on-premises/README.md`
