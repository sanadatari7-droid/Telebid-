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
        # ── users: add password_changed_at (password rotation feature) ────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='password_changed_at'
            ) THEN
                ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ DEFAULT NOW();
                UPDATE users SET password_changed_at = COALESCE(created_at, NOW()) WHERE password_changed_at IS NULL;
                RAISE NOTICE 'Migration: added users.password_changed_at';
            END IF;
        END$$;
        """,
        # ── system_settings: ensure password_rotation_days exists per company ─
        """
        INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label)
        SELECT c.company_id, 'password_rotation_days', '30', 'NUMBER', 'SECURITY', 'Password Rotation (Days)'
        FROM companies c
        ON CONFLICT DO NOTHING;
        """,
        # ── opp_number_seq: atomic opportunity numbering ────────────────────────
        # _gen_opp_number used to be SELECT COUNT(*)+1, which two concurrent
        # requests can both read before either commits, producing a duplicate
        # opp_number and a 500 on one of them — and once that happens, or any
        # row is ever deleted, COUNT(*) permanently falls out of sync with
        # MAX(opp_number) and every future create collides forever. A sequence
        # is atomic under concurrency by construction. Re-synced past the
        # current max on every startup so it self-heals any gap already on
        # disk (from the old logic) without ever moving backward into it.
        """
        DO $$
        DECLARE
            max_num BIGINT;
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='opp_number_seq') THEN
                CREATE SEQUENCE opp_number_seq START WITH 1;
            END IF;
            SELECT COALESCE(MAX(NULLIF(substring(opp_number FROM '(\\d+)$'), '')::BIGINT), 0)
                INTO max_num FROM opportunities_v2;
            IF max_num > 0 THEN
                PERFORM setval('opp_number_seq', GREATEST(max_num, (SELECT last_value FROM opp_number_seq)));
            END IF;
        END$$;
        """,
        # ── companies: Module 1 (Company) / Sub-module A fields ────────────────
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='companies' AND column_name='currency_id'
            ) THEN
                ALTER TABLE companies ADD COLUMN currency_id INT REFERENCES currencies(currency_id) DEFAULT 1;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='companies' AND column_name='currency_decimals'
            ) THEN
                ALTER TABLE companies ADD COLUMN currency_decimals SMALLINT DEFAULT 2 CHECK (currency_decimals IN (2,3,4));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='companies' AND column_name='services_ict'
            ) THEN
                ALTER TABLE companies ADD COLUMN services_ict BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='companies' AND column_name='services_telecom'
            ) THEN
                ALTER TABLE companies ADD COLUMN services_telecom BOOLEAN DEFAULT FALSE;
            END IF;
        END$$;
        """,
        # ── company_evaluators table: Module 1 / Sub-module B ───────────────────
        # Repeatable name/email/title records; "title" is later selectable in
        # Module 2 (RFP ICT)'s evaluation process.
        """
        CREATE TABLE IF NOT EXISTS company_evaluators (
            evaluator_id SERIAL PRIMARY KEY,
            company_id   INT REFERENCES companies(company_id) DEFAULT 1,
            full_name    VARCHAR(150) NOT NULL,
            email        VARCHAR(150),
            title        VARCHAR(150) NOT NULL,
            is_active    BOOLEAN DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── company_pricing_approval table: Module 1 / Sub-module C ─────────────
        """
        CREATE TABLE IF NOT EXISTS company_pricing_approval (
            company_id               INT PRIMARY KEY REFERENCES companies(company_id),
            l1_title                 VARCHAR(100) NOT NULL DEFAULT 'Bid Department Manager',
            l2_title                 VARCHAR(100) NOT NULL DEFAULT 'Sales VP',
            l3_title                 VARCHAR(100) NOT NULL DEFAULT 'Finance',
            telecom_l1_max_discount  NUMERIC(5,2),
            telecom_l2_max_discount  NUMERIC(5,2),
            ict_l1_min_margin        NUMERIC(5,2),
            ict_l2_min_margin        NUMERIC(5,2),
            ebitda_min_pct           NUMERIC(6,2),
            updated_at               TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── company_bond_approval table: Module 1 / Sub-module D ───────────────
        """
        CREATE TABLE IF NOT EXISTS company_bond_approval (
            company_id   INT PRIMARY KEY REFERENCES companies(company_id),
            l1_title     VARCHAR(100) NOT NULL DEFAULT 'Bid Department Manager',
            l2_title     VARCHAR(100) NOT NULL DEFAULT 'VP Sales',
            l3_title     VARCHAR(100) NOT NULL DEFAULT 'Finance',
            office_name  VARCHAR(150) NOT NULL DEFAULT 'Bid Bond Issuance Office',
            office_email VARCHAR(500),
            auto_send    BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ── opportunity_bonds: L1 -> L2 -> L3 approval + issuance-office send ──
        """
        ALTER TABLE opportunity_bonds
            ADD COLUMN IF NOT EXISTS approval_level      SMALLINT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS l1_approved_by      INT REFERENCES users(user_id),
            ADD COLUMN IF NOT EXISTS l1_approver_name    VARCHAR(150),
            ADD COLUMN IF NOT EXISTS l1_approved_at      TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS l2_approved_by      INT REFERENCES users(user_id),
            ADD COLUMN IF NOT EXISTS l2_approver_name    VARCHAR(150),
            ADD COLUMN IF NOT EXISTS l2_approved_at      TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS l3_approved_by      INT REFERENCES users(user_id),
            ADD COLUMN IF NOT EXISTS l3_approver_name    VARCHAR(150),
            ADD COLUMN IF NOT EXISTS l3_approved_at      TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS office_sent_at      TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS office_sent_to      VARCHAR(500),
            ADD COLUMN IF NOT EXISTS office_send_error   TEXT;
        """,
        # ── Modules 2–4 share the RFP tables, which began as Module 2's rfp_ict* ─
        # Rename them where they already exist. This runs before the entries below,
        # so those find the new names instead of creating empty copies.
        """
        DO $$ BEGIN
            IF to_regclass('rfp_ict') IS NOT NULL AND to_regclass('rfps') IS NULL THEN
                ALTER TABLE rfp_ict RENAME TO rfps;
            END IF;
            IF to_regclass('idx_rfp_ict_company_id') IS NOT NULL AND to_regclass('idx_rfps_company_id') IS NULL THEN
                ALTER INDEX idx_rfp_ict_company_id RENAME TO idx_rfps_company_id;
            END IF;
            IF to_regclass('rfp_ict_scope') IS NOT NULL AND to_regclass('rfp_scope') IS NULL THEN
                ALTER TABLE rfp_ict_scope RENAME TO rfp_scope;
            END IF;
            IF to_regclass('rfp_ict_evaluations') IS NOT NULL AND to_regclass('rfp_evaluations') IS NULL THEN
                ALTER TABLE rfp_ict_evaluations RENAME TO rfp_evaluations;
            END IF;
            IF to_regclass('rfp_ict_eval_answers') IS NOT NULL AND to_regclass('rfp_eval_answers') IS NULL THEN
                ALTER TABLE rfp_ict_eval_answers RENAME TO rfp_eval_answers;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'opportunity_bonds' AND column_name = 'rfp_ict_id')
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'opportunity_bonds' AND column_name = 'rfp_id') THEN
                ALTER TABLE opportunity_bonds RENAME COLUMN rfp_ict_id TO rfp_id;
            END IF;
            IF to_regclass('uq_opportunity_bonds_rfp_ict') IS NOT NULL AND to_regclass('uq_opportunity_bonds_rfp') IS NULL THEN
                ALTER INDEX uq_opportunity_bonds_rfp_ict RENAME TO uq_opportunity_bonds_rfp;
            END IF;
        END $$;
        """,
        # ── Module 2 (RFP ICT): clients, RFPs, scope selections ────────────────
        """
        CREATE TABLE IF NOT EXISTS clients (
            client_id           SERIAL PRIMARY KEY,
            company_id          INT NOT NULL REFERENCES companies(company_id),
            name_en             VARCHAR(200) NOT NULL,
            name_ar             VARCHAR(200),
            billing_address_en  TEXT,
            billing_address_ar  TEXT,
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            created_by          INT REFERENCES users(user_id),
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_clients_company_id ON clients(company_id);
        CREATE SEQUENCE IF NOT EXISTS rfp_ict_number_seq START WITH 1;
        CREATE TABLE IF NOT EXISTS rfps (
            rfp_id             SERIAL PRIMARY KEY,
            company_id         INT NOT NULL REFERENCES companies(company_id),
            rfp_number         VARCHAR(30) NOT NULL UNIQUE,
            client_id          INT NOT NULL REFERENCES clients(client_id),
            submission_date    DATE NOT NULL,
            queries_deadline   DATE,
            bid_bond_required  BOOLEAN NOT NULL DEFAULT FALSE,
            bid_bond_pct       NUMERIC(4,2),
            created_by         INT REFERENCES users(user_id),
            created_at         TIMESTAMPTZ DEFAULT NOW(),
            updated_at         TIMESTAMPTZ DEFAULT NOW(),
            CHECK (bid_bond_required = (bid_bond_pct IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_rfps_company_id ON rfps(company_id);
        CREATE TABLE IF NOT EXISTS rfp_scope (
            rfp_id  INT NOT NULL REFERENCES rfps(rfp_id) ON DELETE CASCADE,
            cat_id  INT NOT NULL REFERENCES service_categories(cat_id),
            PRIMARY KEY (rfp_id, cat_id)
        );
        """,
        # ── rfps: File 2 (bid log) fields; clients.is_strategic ────────────────
        """
        -- File 2 (bid log) fields for Module 2
        ALTER TABLE rfps
            ADD COLUMN IF NOT EXISTS rfp_ref          VARCHAR(100),
            ADD COLUMN IF NOT EXISTS channel          VARCHAR(50),
            ADD COLUMN IF NOT EXISTS project_type     VARCHAR(50),
            ADD COLUMN IF NOT EXISTS description      TEXT,
            ADD COLUMN IF NOT EXISTS am_id            INT REFERENCES company_account_managers(am_id),
            ADD COLUMN IF NOT EXISTS presales_emp_id  INT REFERENCES employees(emp_id),
            ADD COLUMN IF NOT EXISTS bm_id            INT REFERENCES company_bid_managers(bm_id),
            ADD COLUMN IF NOT EXISTS phase            VARCHAR(50),
            ADD COLUMN IF NOT EXISTS status           VARCHAR(50),
            ADD COLUMN IF NOT EXISTS reason           VARCHAR(50),
            ADD COLUMN IF NOT EXISTS project_size     VARCHAR(20),
            ADD COLUMN IF NOT EXISTS tcv              NUMERIC(18,4),
            ADD COLUMN IF NOT EXISTS winner_name      VARCHAR(200),
            ADD COLUMN IF NOT EXISTS winner_tcv       NUMERIC(18,4);
        ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_strategic BOOLEAN NOT NULL DEFAULT FALSE;
        """,
        # ── Module 2 / Sub-module 2: RFP Go / No-Go evaluation ────────────────
        """
        CREATE TABLE IF NOT EXISTS rfp_eval_settings (
            company_id  INT PRIMARY KEY REFERENCES companies(company_id),
            pass_mark   NUMERIC(5,2) NOT NULL DEFAULT 60,
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS rfp_eval_questions (
            question_id      SERIAL PRIMARY KEY,
            company_id       INT NOT NULL REFERENCES companies(company_id),
            question         TEXT NOT NULL,
            weight           NUMERIC(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
            evaluator_title  VARCHAR(150),
            sort_order       INT NOT NULL DEFAULT 0,
            is_active        BOOLEAN NOT NULL DEFAULT TRUE,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_rfp_eval_questions_company ON rfp_eval_questions(company_id);
        CREATE TABLE IF NOT EXISTS rfp_eval_options (
            option_id    SERIAL PRIMARY KEY,
            question_id  INT NOT NULL REFERENCES rfp_eval_questions(question_id),
            label        VARCHAR(100) NOT NULL,
            value        NUMERIC(5,2) NOT NULL CHECK (value >= 0 AND value <= 100),
            sort_order   INT NOT NULL DEFAULT 0,
            is_active    BOOLEAN NOT NULL DEFAULT TRUE
        );
        CREATE TABLE IF NOT EXISTS rfp_evaluations (
            rfp_id          INT PRIMARY KEY REFERENCES rfps(rfp_id) ON DELETE CASCADE,
            ebitda_pct      NUMERIC(6,2),
            score           NUMERIC(6,2),
            recommendation  VARCHAR(20),
            updated_by      INT REFERENCES users(user_id),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS rfp_eval_answers (
            rfp_id       INT NOT NULL REFERENCES rfps(rfp_id) ON DELETE CASCADE,
            question_id  INT NOT NULL REFERENCES rfp_eval_questions(question_id),
            option_id    INT NOT NULL REFERENCES rfp_eval_options(option_id),
            comment      TEXT,
            answered_by  INT REFERENCES users(user_id),
            answered_at  TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (rfp_id, question_id)
        );
        """,
        # ── Sub-module 3: RFP bid bonds (stored with the other bonds) ──────────
        """
        ALTER TABLE rfps ADD COLUMN IF NOT EXISTS rfp_title VARCHAR(300);
        ALTER TABLE opportunity_bonds ALTER COLUMN opp_id DROP NOT NULL;
        ALTER TABLE opportunity_bonds
            ADD COLUMN IF NOT EXISTS rfp_id         INT REFERENCES rfps(rfp_id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS validity_days  INT;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_bonds_rfp ON opportunity_bonds(rfp_id) WHERE rfp_id IS NOT NULL;
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bond_has_parent') THEN
                ALTER TABLE opportunity_bonds ADD CONSTRAINT chk_bond_has_parent CHECK (opp_id IS NOT NULL OR rfp_id IS NOT NULL);
            END IF;
        END$$;
        """,
        # ── Modules 3 (RFP Telecom) and 4 (EXPRO): same RFP tables, by module ──
        """
        ALTER TABLE rfps ADD COLUMN IF NOT EXISTS module VARCHAR(10) NOT NULL DEFAULT 'ICT';
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rfps_module') THEN
                ALTER TABLE rfps ADD CONSTRAINT chk_rfps_module CHECK (module IN ('ICT', 'TELECOM', 'EXPRO'));
            END IF;
        END$$;
        CREATE INDEX IF NOT EXISTS idx_rfps_company_module ON rfps(company_id, module);
        CREATE SEQUENCE IF NOT EXISTS rfp_telecom_number_seq START WITH 1;
        CREATE SEQUENCE IF NOT EXISTS rfp_expro_number_seq START WITH 1;
        -- Telecom fields (old app + EXPRO log) and EXPRO's U.Date and comments
        ALTER TABLE rfps
            ADD COLUMN IF NOT EXISTS request_date       DATE,
            ADD COLUMN IF NOT EXISTS sow                TEXT,
            ADD COLUMN IF NOT EXISTS media              VARCHAR(50),
            ADD COLUMN IF NOT EXISTS sla                VARCHAR(50),
            ADD COLUMN IF NOT EXISTS bandwidth_mbps     NUMERIC(12,2),
            ADD COLUMN IF NOT EXISTS quantity           INT,
            ADD COLUMN IF NOT EXISTS contract_duration  VARCHAR(50),
            ADD COLUMN IF NOT EXISTS coverage_study     VARCHAR(100),
            ADD COLUMN IF NOT EXISTS location           TEXT,
            ADD COLUMN IF NOT EXISTS attachment_url     TEXT,
            ADD COLUMN IF NOT EXISTS nrc                NUMERIC(18,4),
            ADD COLUMN IF NOT EXISTS mrc                NUMERIC(18,4),
            ADD COLUMN IF NOT EXISTS presales_comment   TEXT,
            ADD COLUMN IF NOT EXISTS am_comment         TEXT,
            ADD COLUMN IF NOT EXISTS bid_comment        TEXT;
        -- Each module has its own evaluation questions and pass mark
        ALTER TABLE rfp_eval_questions ADD COLUMN IF NOT EXISTS module VARCHAR(10) NOT NULL DEFAULT 'ICT';
        ALTER TABLE rfp_eval_settings ADD COLUMN IF NOT EXISTS module VARCHAR(10) NOT NULL DEFAULT 'ICT';
        DO $$ BEGIN
            IF (SELECT array_length(conkey, 1) FROM pg_constraint
                WHERE conrelid = 'rfp_eval_settings'::regclass AND contype = 'p') = 1 THEN
                ALTER TABLE rfp_eval_settings DROP CONSTRAINT rfp_eval_settings_pkey;
                ALTER TABLE rfp_eval_settings ADD PRIMARY KEY (company_id, module);
            END IF;
        END$$;
        CREATE INDEX IF NOT EXISTS idx_rfp_eval_questions_module ON rfp_eval_questions(company_id, module);
        """,
        # ── Sub-module C: RFP checklist (site visit, special terms, insurance) ──
        """
        CREATE TABLE IF NOT EXISTS rfp_checklists (
            rfp_id                      INT PRIMARY KEY REFERENCES rfps(rfp_id) ON DELETE CASCADE,
            site_visit_required         BOOLEAN NOT NULL,
            site_visit_am_id            INT REFERENCES company_account_managers(am_id),
            special_terms_required      BOOLEAN NOT NULL,
            special_terms               TEXT,
            special_terms_status        VARCHAR(20) CHECK (special_terms_status IN ('PENDING', 'APPROVED', 'NOT_APPROVED')),
            special_terms_decided_by    INT REFERENCES users(user_id),
            special_terms_decider_name  VARCHAR(150),
            special_terms_decided_at    TIMESTAMPTZ,
            special_terms_note          TEXT,
            insurance_required          BOOLEAN NOT NULL,
            insurance_policies          TEXT[] NOT NULL DEFAULT '{}',
            updated_by                  INT REFERENCES users(user_id),
            updated_at                  TIMESTAMPTZ DEFAULT NOW()
        );
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


_is_production = settings.ENVIRONMENT.lower() == "production"

app = FastAPI(
    title="TeleBid Enterprise API",
    description="Enterprise Bid & Tender Management System",
    version="1.0.0",
    docs_url=None if _is_production else "/api/docs",
    redoc_url=None if _is_production else "/api/redoc",
    openapi_url=None if _is_production else "/openapi.json",
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
        # Defense-in-depth headers — this is a JSON API behind a React SPA, not
        # a page an attacker can get framed or MIME-sniffed on its own, but
        # these are cheap and expected practice regardless.
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        if _is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
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
