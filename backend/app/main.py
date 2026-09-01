from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.core.config import settings
from app.db.postgres import init_pool, close_pool
from app.api.v1.router import api_router
import logging, time, fnmatch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s — %(name)s — %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)


async def run_migrations():
    """
    Run safe ALTER TABLE migrations on every startup.
    Uses IF NOT EXISTS / DO $$ blocks so they are idempotent —
    safe to run on both fresh and existing databases.
    """
    from app.db.postgres import pool
    if not pool:
        return

    MIGRATIONS = [
        # ── otp_tokens: add session_token (THE LOGIN BUG FIX) ────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='otp_tokens' AND column_name='session_token'
            ) THEN
                ALTER TABLE otp_tokens ADD COLUMN session_token VARCHAR(64);
                RAISE NOTICE 'Migration: added otp_tokens.session_token';
            END IF;
        END$$;
        """,
        # ── users: ensure otp_enabled column exists ───────────────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='otp_enabled'
            ) THEN
                ALTER TABLE users ADD COLUMN otp_enabled BOOLEAN DEFAULT FALSE;
            END IF;
        END$$;
        """,
        # ── users: ensure otp_secret column exists ────────────────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='otp_secret'
            ) THEN
                ALTER TABLE users ADD COLUMN otp_secret VARCHAR(64);
            END IF;
        END$$;
        """,
        # ── Disable OTP for admin (safe — only changes if currently TRUE) ─────
        "UPDATE users SET otp_enabled=FALSE WHERE username='admin' AND otp_enabled=TRUE;",
        # ── opportunities_v2: add new columns safely ──────────────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='bond_required') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN bond_required BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='bond_reminder_sent') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN bond_reminder_sent BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='manager_id') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN manager_id INT REFERENCES users(user_id);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='source_single') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN source_single VARCHAR(20);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='customer_ref') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN customer_ref VARCHAR(200);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='questions_count') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN questions_count INT DEFAULT 0;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities_v2' AND column_name='questions_open') THEN
                ALTER TABLE opportunities_v2 ADD COLUMN questions_open INT DEFAULT 0;
            END IF;
        END$$;
        """,
        # ── employees: add profile columns ────────────────────────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='initials') THEN
                ALTER TABLE employees ADD COLUMN initials VARCHAR(10);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='sectors_covered') THEN
                ALTER TABLE employees ADD COLUMN sectors_covered TEXT;
            END IF;
        END$$;
        """,
        # ── audit_logs: add username and module columns ───────────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='username') THEN
                ALTER TABLE audit_logs ADD COLUMN username VARCHAR(100);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='module') THEN
                ALTER TABLE audit_logs ADD COLUMN module VARCHAR(100);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='ip_address') THEN
                ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(45);
            END IF;
        END$$;
        """,
        # ── won_records table ─────────────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS won_records (
            won_id           SERIAL PRIMARY KEY,
            opp_id           INT NOT NULL REFERENCES opportunities_v2(opp_id),
            won_number       VARCHAR(50) UNIQUE NOT NULL,
            company_id       INT REFERENCES companies(company_id) DEFAULT 1,
            expro_ref        VARCHAR(50),
            po_number        VARCHAR(100),
            customer_name    VARCHAR(200),
            customer_name_ar VARCHAR(200),
            customer_id      VARCHAR(100),
            customer_ref     VARCHAR(200),
            media_type       VARCHAR(30),
            sla_type         VARCHAR(30),
            bandwidth_mbps   NUMERIC(10,2),
            quantity         INT,
            sow_detail       TEXT,
            solution_detail  VARCHAR(200),
            family_id        INT REFERENCES solution_families(family_id),
            solution_id      INT REFERENCES solution_types(solution_id),
            nrc              NUMERIC(18,2),
            mrc              NUMERIC(18,2),
            tcv              NUMERIC(18,2),
            currency_id      INT REFERENCES currencies(currency_id) DEFAULT 1,
            contract_duration VARCHAR(50),
            coverage_study   VARCHAR(100),
            project_size     VARCHAR(10),
            location_text    VARCHAR(300),
            sales_rep_id     INT REFERENCES users(user_id),
            presales_id      INT REFERENCES users(user_id),
            bid_manager_id   INT REFERENCES users(user_id),
            submission_deadline TIMESTAMPTZ,
            po_date          DATE,
            discount_applied NUMERIC(5,2),
            discount_amount  NUMERIC(18,2),
            final_value      NUMERIC(18,2),
            won_date         DATE NOT NULL,
            order_number     VARCHAR(100),
            order_summary    TEXT,
            invoice_status   VARCHAR(30) DEFAULT 'NOT_INVOICED',
            invoice_number   VARCHAR(100),
            invoice_date     DATE,
            invoice_amount   NUMERIC(18,2),
            payment_terms    VARCHAR(100),
            bid_person_notes TEXT,
            won_status       VARCHAR(30) DEFAULT 'ACTIVE',
            won_by           INT NOT NULL REFERENCES users(user_id),
            completed_by     INT REFERENCES users(user_id),
            completed_at     TIMESTAMPTZ,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW(),
            is_deleted       BOOLEAN DEFAULT FALSE,
            CONSTRAINT one_won_per_opp UNIQUE (opp_id)
        );
        """,
        # ── lost_records table ────────────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS lost_records (
            lost_id          SERIAL PRIMARY KEY,
            opp_id           INT NOT NULL REFERENCES opportunities_v2(opp_id),
            lost_number      VARCHAR(50) UNIQUE NOT NULL,
            company_id       INT REFERENCES companies(company_id) DEFAULT 1,
            expro_ref        VARCHAR(50),
            rfp_ref          VARCHAR(100),
            customer_name    VARCHAR(200),
            customer_name_ar VARCHAR(200),
            customer_id      VARCHAR(100),
            customer_ref     VARCHAR(200),
            media_type       VARCHAR(30),
            sla_type         VARCHAR(30),
            bandwidth_mbps   NUMERIC(10,2),
            quantity         INT,
            sow_detail       TEXT,
            solution_detail  VARCHAR(200),
            family_id        INT REFERENCES solution_families(family_id),
            solution_id      INT REFERENCES solution_types(solution_id),
            nrc              NUMERIC(18,2),
            mrc              NUMERIC(18,2),
            tcv              NUMERIC(18,2),
            currency_id      INT REFERENCES currencies(currency_id) DEFAULT 1,
            submission_deadline TIMESTAMPTZ,
            sales_rep_id     INT REFERENCES users(user_id),
            presales_id      INT REFERENCES users(user_id),
            bid_manager_id   INT REFERENCES users(user_id),
            lost_date        DATE NOT NULL,
            loss_type        VARCHAR(30) NOT NULL,
            loss_reason      VARCHAR(200),
            competitor_name  VARCHAR(200),
            winner_name      VARCHAR(200),
            winner_tcv       NUMERIC(18,2),
            winner_solution  VARCHAR(200),
            price_difference NUMERIC(18,2),
            technical_gap    TEXT,
            lessons_learned  TEXT,
            bid_person_notes TEXT,
            could_revisit    BOOLEAN DEFAULT FALSE,
            revisit_notes    TEXT,
            lost_by          INT NOT NULL REFERENCES users(user_id),
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW(),
            is_deleted       BOOLEAN DEFAULT FALSE,
            CONSTRAINT one_lost_per_opp UNIQUE (opp_id)
        );
        """,
        # ── opportunity_questions table ───────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_questions (
            question_id  SERIAL PRIMARY KEY,
            opp_id       INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            question_text TEXT NOT NULL,
            assigned_to  INT REFERENCES users(user_id),
            deadline_dt  TIMESTAMPTZ,
            status       VARCHAR(20) DEFAULT 'OPEN',
            response     TEXT,
            responded_at TIMESTAMPTZ,
            responded_by INT REFERENCES users(user_id),
            priority     VARCHAR(10) DEFAULT 'NORMAL',
            created_by   INT NOT NULL REFERENCES users(user_id),
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── expro_feasibility table ───────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS expro_feasibility (
            feasibility_id  SERIAL PRIMARY KEY,
            opp_id          INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            sales_emp_id    INT REFERENCES employees(emp_id),
            sales_name      VARCHAR(150),
            sales_initials  VARCHAR(10),
            sales_title     VARCHAR(100),
            sales_sectors   TEXT,
            sales_notes     TEXT,
            presales_emp_id INT REFERENCES employees(emp_id),
            presales_name   VARCHAR(150),
            presales_initials VARCHAR(10),
            presales_title  VARCHAR(100),
            presales_sectors TEXT,
            presales_notes  TEXT,
            feasibility_status VARCHAR(20) DEFAULT 'PENDING',
            feasibility_notes  TEXT,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (opp_id)
        );
        """,
        # ── opportunity_team table ────────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_team (
            team_id      SERIAL PRIMARY KEY,
            opp_id       INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            emp_id       INT NOT NULL REFERENCES employees(emp_id),
            role         VARCHAR(20) NOT NULL,
            full_name    VARCHAR(150),
            initials     VARCHAR(10),
            job_title    VARCHAR(100),
            sectors      TEXT,
            notes        TEXT,
            added_at     TIMESTAMPTZ DEFAULT NOW(),
            added_by     INT REFERENCES users(user_id),
            UNIQUE (opp_id, emp_id, role)
        );
        """,
        # ── customer_ref_config table ─────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS customer_ref_config (
            config_id         SERIAL PRIMARY KEY,
            company_id        INT REFERENCES companies(company_id) DEFAULT 1,
            use_company_initials  BOOLEAN DEFAULT FALSE,
            use_presales_initials BOOLEAN DEFAULT TRUE,
            use_am_initials       BOOLEAN DEFAULT FALSE,
            use_cash              BOOLEAN DEFAULT FALSE,
            use_customer_id       BOOLEAN DEFAULT TRUE,
            use_client_initials   BOOLEAN DEFAULT FALSE,
            use_version           BOOLEAN DEFAULT FALSE,
            separator             VARCHAR(5) DEFAULT '-',
            company_initials      VARCHAR(10) DEFAULT 'SLM',
            cash_label            VARCHAR(20) DEFAULT 'CASH',
            version_label         VARCHAR(10) DEFAULT '1.x',
            ref_number_prefix     VARCHAR(20) DEFAULT '',
            require_unique        BOOLEAN DEFAULT TRUE,
            updated_at            TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (company_id)
        );
        INSERT INTO customer_ref_config (company_id) VALUES (1) ON CONFLICT DO NOTHING;
        """,
        # ── opportunity_bonds table ───────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_bonds (
            bond_id        SERIAL PRIMARY KEY,
            opp_id         INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            bond_type      VARCHAR(20) NOT NULL,
            bond_number    VARCHAR(100),
            bond_amount    NUMERIC(18,2),
            currency_id    INT REFERENCES currencies(currency_id) DEFAULT 1,
            issue_date     DATE,
            expiry_date    DATE,
            issuer_bank    VARCHAR(200),
            beneficiary    VARCHAR(200),
            status         VARCHAR(20) DEFAULT 'PENDING',
            notes          TEXT,
            approved_by    INT REFERENCES users(user_id),
            approved_at    TIMESTAMPTZ,
            created_by     INT NOT NULL REFERENCES users(user_id),
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            updated_at     TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── service_categories table ──────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS service_categories (
            cat_id       SERIAL PRIMARY KEY,
            company_id   INT REFERENCES companies(company_id) DEFAULT 1,
            parent_id    INT REFERENCES service_categories(cat_id),
            service_type VARCHAR(20) NOT NULL,
            cat_name     VARCHAR(100) NOT NULL,
            cat_name_ar  VARCHAR(100),
            level        INT DEFAULT 1,
            sort_order   INT DEFAULT 0,
            is_active    BOOLEAN DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── company_account_managers table ────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS company_account_managers (
            am_id        SERIAL PRIMARY KEY,
            company_id   INT REFERENCES companies(company_id) DEFAULT 1,
            user_id      INT REFERENCES users(user_id),
            emp_id       INT REFERENCES employees(emp_id),
            full_name    VARCHAR(150) NOT NULL,
            initials     VARCHAR(10),
            email        VARCHAR(150),
            is_active    BOOLEAN DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── company_bid_managers table ────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS company_bid_managers (
            bm_id        SERIAL PRIMARY KEY,
            company_id   INT REFERENCES companies(company_id) DEFAULT 1,
            user_id      INT REFERENCES users(user_id),
            emp_id       INT REFERENCES employees(emp_id),
            full_name    VARCHAR(150) NOT NULL,
            initials     VARCHAR(10),
            email        VARCHAR(150),
            is_active    BOOLEAN DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── opportunity_logs table ────────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_logs (
            log_id        SERIAL PRIMARY KEY,
            opp_id        INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            action        VARCHAR(60) NOT NULL,
            field_name    VARCHAR(100),
            old_value     TEXT,
            new_value     TEXT,
            performed_by  INT REFERENCES users(user_id),
            comments      TEXT,
            performed_at  TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── opportunity_deadlines table ───────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_deadlines (
            deadline_id    SERIAL PRIMARY KEY,
            opp_id         INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            deadline_type  VARCHAR(30) NOT NULL,
            deadline_label VARCHAR(100),
            deadline_dt    TIMESTAMPTZ,
            responsible_id INT REFERENCES users(user_id),
            status         VARCHAR(20) DEFAULT 'PENDING',
            notes          TEXT,
            created_at     TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── opportunity_approvals table ───────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS opportunity_approvals (
            approval_id    SERIAL PRIMARY KEY,
            opp_id         INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
            approval_level INT NOT NULL DEFAULT 1,
            status         VARCHAR(30) DEFAULT 'PENDING',
            approver_id    INT REFERENCES users(user_id),
            approver_name  VARCHAR(150),
            approver_position VARCHAR(100),
            comments       TEXT,
            decided_at     TIMESTAMPTZ,
            is_locked      BOOLEAN DEFAULT FALSE,
            created_at     TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── system_settings: ensure EMAIL settings exist ──────────────────────
        """
        INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label)
        VALUES
            (1,'smtp_host','','TEXT','EMAIL','SMTP Host'),
            (1,'smtp_port','587','TEXT','EMAIL','SMTP Port'),
            (1,'smtp_user','','TEXT','EMAIL','SMTP Username'),
            (1,'smtp_password','','TEXT','EMAIL','SMTP Password'),
            (1,'smtp_from_name','TeleBid Enterprise','TEXT','EMAIL','From Name'),
            (1,'smtp_from_email','','TEXT','EMAIL','From Email'),
            (1,'smtp_use_tls','true','BOOL','EMAIL','Use TLS'),
            (1,'email_enabled','false','BOOL','EMAIL','Enable Email')
        ON CONFLICT DO NOTHING;
        """,
    ]

    async with pool.acquire() as conn:
        for i, sql in enumerate(MIGRATIONS, 1):
            try:
                await conn.execute(sql)
            except Exception as e:
                logger.warning(f"Migration {i} skipped or partial: {e}")

    logger.info(f"✅ {len(MIGRATIONS)} migrations checked/applied")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting TeleBid Enterprise API...")
    await init_pool()
    # Run migrations on every startup — idempotent, safe on both fresh and existing DBs
    try:
        await run_migrations()
    except Exception as e:
        logger.error(f"Migration error (non-fatal): {e}")
    logger.info("✅ Ready to accept requests")
    yield
    logger.info("Shutting down...")
    await close_pool()


app = FastAPI(
    title="TeleBid Enterprise API",
    description="Enterprise Bid & Tender Management System",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan
)

# Starlette's CORSMiddleware only does exact-string matching on allow_origins
# (aside from a bare "*"), so glob entries like "https://*.vercel.app" need to
# go through allow_origin_regex instead or they silently never match.
_exact_origins = [o for o in settings.CORS_ORIGINS if "*" not in o]
_glob_origins = [o for o in settings.CORS_ORIGINS if "*" in o]
_origin_regex = "|".join(fnmatch.translate(o) for o in _glob_origins) or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=_exact_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.time()
    try:
        response = await call_next(request)
        response.headers["X-Process-Time"] = f"{time.time()-start:.4f}s"
        return response
    except Exception as exc:
        logger.error(f"Request error on {request.method} {request.url}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"}
        )

app.include_router(api_router)

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "TeleBid Enterprise API", "version": "1.0.0"}

@app.get("/api/v1/health")
async def api_health():
    from app.db.postgres import pool
    db_ok = pool is not None
    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "version": "1.0.0"
    }
