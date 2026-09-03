-- TeleBid Enterprise — PostgreSQL Schema + Seed Data
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- LOOKUP TABLES
CREATE TABLE IF NOT EXISTS bid_types (
    type_id SERIAL PRIMARY KEY, type_code VARCHAR(10) UNIQUE NOT NULL,
    type_name VARCHAR(50) NOT NULL, is_active BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS bid_statuses (
    status_id SERIAL PRIMARY KEY, status_code VARCHAR(30) UNIQUE NOT NULL,
    status_name VARCHAR(80) NOT NULL, sort_order INT DEFAULT 0, color_hex VARCHAR(10)
);
CREATE TABLE IF NOT EXISTS currencies (
    currency_id SERIAL PRIMARY KEY, currency_code VARCHAR(5) UNIQUE NOT NULL,
    currency_name VARCHAR(50) NOT NULL, symbol VARCHAR(5)
);
CREATE TABLE IF NOT EXISTS procurement_categories (
    category_id SERIAL PRIMARY KEY, category_name VARCHAR(100) NOT NULL,
    description TEXT, is_active BOOLEAN DEFAULT TRUE
);

-- ROLES & DEPARTMENTS
CREATE TABLE IF NOT EXISTS roles (
    role_id SERIAL PRIMARY KEY, role_code VARCHAR(30) UNIQUE NOT NULL,
    role_name VARCHAR(80) NOT NULL, description TEXT, is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS departments (
    dept_id SERIAL PRIMARY KEY, dept_code VARCHAR(20) UNIQUE NOT NULL,
    dept_name VARCHAR(100) NOT NULL, manager_id INT, is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USERS
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL, phone VARCHAR(30), dept_id INT REFERENCES departments(dept_id),
    job_title VARCHAR(100), avatar_url VARCHAR(500), is_active BOOLEAN DEFAULT TRUE,
    is_locked BOOLEAN DEFAULT FALSE, failed_attempts INT DEFAULT 0,
    otp_secret VARCHAR(100), otp_enabled BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(), created_by INT
);
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INT NOT NULL REFERENCES users(user_id),
    role_id INT NOT NULL REFERENCES roles(role_id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(), assigned_by INT,
    PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS otp_tokens (
    otp_id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(user_id),
    otp_code VARCHAR(10) NOT NULL, otp_type VARCHAR(20) DEFAULT 'LOGIN',
    is_used BOOLEAN DEFAULT FALSE, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    session_token   VARCHAR(64)
);

-- Add session_token to otp_tokens if it doesn't already exist (safe migration)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='otp_tokens' AND column_name='session_token'
    ) THEN
        ALTER TABLE otp_tokens ADD COLUMN session_token VARCHAR(64);
    END IF;
END$$;

-- Disable OTP for admin by default (enable only after configuring SMTP)
UPDATE users SET otp_enabled=FALSE WHERE username='admin';

-- COMPANY REFERENCES
CREATE TABLE IF NOT EXISTS company_references (
    ref_id SERIAL PRIMARY KEY, ref_number VARCHAR(100) UNIQUE NOT NULL,
    company_name VARCHAR(200) NOT NULL, client_name VARCHAR(200) NOT NULL,
    project_name VARCHAR(300) NOT NULL, sales_rep_id INT NOT NULL REFERENCES users(user_id),
    presales_eng_id INT NOT NULL REFERENCES users(user_id),
    project_value NUMERIC(18,2), currency_id INT REFERENCES currencies(currency_id),
    industry VARCHAR(100), country VARCHAR(100), start_date DATE, completion_date DATE,
    description TEXT, current_version INT DEFAULT 1, status VARCHAR(20) DEFAULT 'ACTIVE',
    is_deleted BOOLEAN DEFAULT FALSE, created_by INT NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_by INT REFERENCES users(user_id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS company_ref_versions (
    version_id SERIAL PRIMARY KEY, ref_id INT NOT NULL REFERENCES company_references(ref_id),
    version_number INT NOT NULL, company_name VARCHAR(200), client_name VARCHAR(200),
    project_name VARCHAR(300), project_value NUMERIC(18,2), description TEXT,
    change_summary VARCHAR(1000), changed_by INT NOT NULL REFERENCES users(user_id),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
    emp_id SERIAL PRIMARY KEY, user_id INT UNIQUE REFERENCES users(user_id),
    employee_code VARCHAR(30) UNIQUE NOT NULL, full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL, department VARCHAR(100), job_title VARCHAR(100),
    employee_type VARCHAR(20) NOT NULL CHECK (employee_type IN ('SALES','PRESALES','MANAGER','ADMIN')),
    tech_specialty VARCHAR(200), is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sales_presales_mapping (
    mapping_id SERIAL PRIMARY KEY, sales_emp_id INT NOT NULL REFERENCES employees(emp_id),
    presales_emp_id INT NOT NULL REFERENCES employees(emp_id),
    is_active BOOLEAN DEFAULT TRUE, created_by INT NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (sales_emp_id)
);

-- OPPORTUNITIES
CREATE TABLE IF NOT EXISTS opportunities (
    opp_id SERIAL PRIMARY KEY, opp_number VARCHAR(30) UNIQUE NOT NULL,
    title VARCHAR(300) NOT NULL,
    procurement_type VARCHAR(20) NOT NULL CHECK (procurement_type IN ('TENDER','BID','RFQ','RFP','RFI')),
    company_ref_required VARCHAR(20) DEFAULT 'NOT_APPLICABLE',
    company_ref_id INT REFERENCES company_references(ref_id),
    customer_name VARCHAR(200), dept_id INT REFERENCES departments(dept_id),
    sales_rep_id INT REFERENCES users(user_id), presales_eng_id INT REFERENCES users(user_id),
    dept_manager_id INT REFERENCES users(user_id), bid_manager_id INT REFERENCES users(user_id),
    submission_deadline DATE, status VARCHAR(40) DEFAULT 'DRAFT',
    current_step VARCHAR(50) DEFAULT 'INITIATION', go_nogo_decision VARCHAR(10),
    go_nogo_reason TEXT, is_deleted BOOLEAN DEFAULT FALSE,
    created_by INT NOT NULL REFERENCES users(user_id), created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by INT REFERENCES users(user_id), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRESALES EVALUATIONS
CREATE TABLE IF NOT EXISTS presales_evaluations (
    eval_id SERIAL PRIMARY KEY, opp_id INT NOT NULL UNIQUE REFERENCES opportunities(opp_id),
    evaluator_id INT NOT NULL REFERENCES users(user_id),
    opp_understanding TEXT, technical_fit VARCHAR(20), solution_availability VARCHAR(20),
    resource_availability VARCHAR(20), impl_complexity VARCHAR(20), delivery_timeline VARCHAR(200),
    required_vendors TEXT, required_partners TEXT, technical_risks TEXT, commercial_risks TEXT,
    competitor_info TEXT, customer_relationship VARCHAR(20), strategic_value VARCHAR(20),
    required_references TEXT, comments TEXT,
    recommendation VARCHAR(10) CHECK (recommendation IN ('GO','NO_GO')),
    status VARCHAR(20) DEFAULT 'DRAFT', submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PURCHASE REQUESTS
CREATE TABLE IF NOT EXISTS purchase_requests (
    pr_id SERIAL PRIMARY KEY, pr_number VARCHAR(30) UNIQUE NOT NULL,
    opp_id INT NOT NULL REFERENCES opportunities(opp_id), customer_name VARCHAR(200),
    procurement_type VARCHAR(20), bid_manager_id INT REFERENCES users(user_id),
    required_products TEXT, required_vendors TEXT, budget NUMERIC(18,2),
    currency_id INT REFERENCES currencies(currency_id), required_delivery DATE,
    comments TEXT, status VARCHAR(30) DEFAULT 'PURCHASE_PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BIDS
CREATE TABLE IF NOT EXISTS bids (
    bid_id SERIAL PRIMARY KEY, bid_number VARCHAR(30) UNIQUE NOT NULL,
    opp_id INT REFERENCES opportunities(opp_id), bid_title VARCHAR(300) NOT NULL,
    description TEXT, dept_id INT REFERENCES departments(dept_id),
    category_id INT REFERENCES procurement_categories(category_id),
    budget NUMERIC(18,2), currency_id INT DEFAULT 1 REFERENCES currencies(currency_id),
    bid_source VARCHAR(20) CHECK (bid_source IN ('EMAIL','INVITATION','PORTAL','OTHER')),
    bid_type_id INT NOT NULL REFERENCES bid_types(type_id),
    submission_deadline TIMESTAMPTZ, opening_date TIMESTAMPTZ, closing_date TIMESTAMPTZ,
    status_id INT NOT NULL REFERENCES bid_statuses(status_id),
    qr_code_data VARCHAR(500), is_deleted BOOLEAN DEFAULT FALSE,
    created_by INT NOT NULL REFERENCES users(user_id), created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by INT REFERENCES users(user_id), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- VENDORS
CREATE TABLE IF NOT EXISTS vendors (
    vendor_id SERIAL PRIMARY KEY, company_name VARCHAR(200) NOT NULL,
    registration_no VARCHAR(100), tax_number VARCHAR(100), contact_person VARCHAR(150),
    email VARCHAR(150), phone VARCHAR(30), address TEXT, business_category VARCHAR(100),
    vendor_rating NUMERIC(3,2), is_blacklisted BOOLEAN DEFAULT FALSE,
    blacklist_reason VARCHAR(500), is_active BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE,
    created_by INT REFERENCES users(user_id), created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS vendor_performance (
    perf_id SERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
    contract_id INT, eval_score NUMERIC(5,2), delivery_rating NUMERIC(3,2),
    quality_rating NUMERIC(3,2), support_rating NUMERIC(3,2), late_deliveries INT DEFAULT 0,
    notes TEXT, evaluated_at TIMESTAMPTZ DEFAULT NOW(), evaluated_by INT REFERENCES users(user_id)
);

-- INVITATIONS
CREATE TABLE IF NOT EXISTS invitations (
    inv_id SERIAL PRIMARY KEY, bid_id INT NOT NULL REFERENCES bids(bid_id),
    vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
    inv_code VARCHAR(50) UNIQUE NOT NULL, invited_by INT NOT NULL REFERENCES users(user_id),
    date_sent TIMESTAMPTZ DEFAULT NOW(), date_opened TIMESTAMPTZ, date_responded TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'SENT' CHECK (status IN ('SENT','OPENED','ACCEPTED','DECLINED','NO_RESPONSE')),
    response_notes VARCHAR(500), email_sent BOOLEAN DEFAULT FALSE
);

-- DOCUMENTS
CREATE TABLE IF NOT EXISTS documents (
    doc_id SERIAL PRIMARY KEY, bid_id INT REFERENCES bids(bid_id),
    opp_id INT REFERENCES opportunities(opp_id), vendor_id INT REFERENCES vendors(vendor_id),
    ref_id INT REFERENCES company_references(ref_id), doc_type VARCHAR(50) NOT NULL,
    doc_name VARCHAR(300) NOT NULL, file_path VARCHAR(1000) NOT NULL,
    file_size BIGINT, file_ext VARCHAR(10), mime_type VARCHAR(100), version INT DEFAULT 1,
    expiry_date DATE, is_deleted BOOLEAN DEFAULT FALSE,
    uploaded_by INT NOT NULL REFERENCES users(user_id), uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- EVALUATIONS
CREATE TABLE IF NOT EXISTS evaluation_templates (
    tmpl_id SERIAL PRIMARY KEY, tmpl_name VARCHAR(200) NOT NULL,
    description VARCHAR(1000), bid_type_id INT REFERENCES bid_types(type_id),
    is_active BOOLEAN DEFAULT TRUE, created_by INT NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS evaluation_criteria (
    crit_id SERIAL PRIMARY KEY, tmpl_id INT NOT NULL REFERENCES evaluation_templates(tmpl_id),
    crit_name VARCHAR(200) NOT NULL,
    crit_type VARCHAR(20) DEFAULT 'TECHNICAL' CHECK (crit_type IN ('TECHNICAL','FINANCIAL','COMPLIANCE')),
    weight NUMERIC(5,2) NOT NULL, max_score NUMERIC(5,2) DEFAULT 100,
    description VARCHAR(500), sort_order INT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bid_evaluations (
    bid_eval_id SERIAL PRIMARY KEY, bid_id INT NOT NULL REFERENCES bids(bid_id),
    tmpl_id INT NOT NULL REFERENCES evaluation_templates(tmpl_id),
    evaluator_id INT NOT NULL REFERENCES users(user_id),
    eval_type VARCHAR(20) DEFAULT 'TECHNICAL', status VARCHAR(20) DEFAULT 'ASSIGNED',
    tech_score NUMERIC(8,2), fin_score NUMERIC(8,2), total_score NUMERIC(8,2),
    comments TEXT, submitted_at TIMESTAMPTZ, assigned_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS evaluation_scores (
    score_id SERIAL PRIMARY KEY, bid_eval_id INT NOT NULL REFERENCES bid_evaluations(bid_eval_id),
    crit_id INT NOT NULL REFERENCES evaluation_criteria(crit_id),
    vendor_id INT REFERENCES vendors(vendor_id), score NUMERIC(8,2) NOT NULL,
    max_score NUMERIC(8,2), comments VARCHAR(1000), scored_at TIMESTAMPTZ DEFAULT NOW()
);

-- APPROVALS
CREATE TABLE IF NOT EXISTS approvals (
    approval_id SERIAL PRIMARY KEY, bid_id INT REFERENCES bids(bid_id),
    opp_id INT REFERENCES opportunities(opp_id), approval_type VARCHAR(50) NOT NULL,
    approver_id INT NOT NULL REFERENCES users(user_id), approval_level INT DEFAULT 1,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','INFO_REQUESTED')),
    decision VARCHAR(20), comments TEXT, decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONTRACTS
CREATE TABLE IF NOT EXISTS contracts (
    contract_id SERIAL PRIMARY KEY, contract_number VARCHAR(30) UNIQUE NOT NULL,
    bid_id INT NOT NULL REFERENCES bids(bid_id), vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
    contract_title VARCHAR(300), contract_value NUMERIC(18,2),
    currency_id INT REFERENCES currencies(currency_id), start_date DATE, end_date DATE,
    status VARCHAR(20) DEFAULT 'DRAFT', signed_at TIMESTAMPTZ, signed_by INT REFERENCES users(user_id),
    notes TEXT, is_deleted BOOLEAN DEFAULT FALSE, created_by INT REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTIFICATIONS & AUDIT
CREATE TABLE IF NOT EXISTS notifications (
    notif_id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(user_id),
    notif_type VARCHAR(50), title VARCHAR(200) NOT NULL, body TEXT, link_url VARCHAR(500),
    is_read BOOLEAN DEFAULT FALSE, email_sent BOOLEAN DEFAULT FALSE,
    related_bid INT REFERENCES bids(bid_id), related_opp INT REFERENCES opportunities(opp_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id SERIAL PRIMARY KEY, user_id INT REFERENCES users(user_id),
    username VARCHAR(50), action VARCHAR(100) NOT NULL, module VARCHAR(50),
    record_id INT, record_type VARCHAR(50), old_value TEXT, new_value TEXT,
    ip_address VARCHAR(50), user_agent VARCHAR(500), action_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS comments (
    comment_id SERIAL PRIMARY KEY, bid_id INT REFERENCES bids(bid_id),
    opp_id INT REFERENCES opportunities(opp_id), parent_id INT, body TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE,
    created_by INT NOT NULL REFERENCES users(user_id), created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username  ON users(username);
CREATE INDEX IF NOT EXISTS idx_bids_status     ON bids(status_id);
CREATE INDEX IF NOT EXISTS idx_bids_deadline   ON bids(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_bids_created    ON bids(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_status      ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_bids_title_trgm ON bids USING gin(bid_title gin_trgm_ops);

-- AUTO-UPDATE TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_users_updated') THEN
    CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_bids_updated') THEN
    CREATE TRIGGER trg_bids_updated BEFORE UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_opp_updated') THEN
    CREATE TRIGGER trg_opp_updated BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- SEED DATA
-- ============================================================
INSERT INTO currencies (currency_code,currency_name,symbol) VALUES
  ('USD','US Dollar','$'),('JOD','Jordanian Dinar','JD'),
  ('SAR','Saudi Riyal','SR'),('AED','UAE Dirham','AED'),('EUR','Euro','€')
ON CONFLICT DO NOTHING;

INSERT INTO bid_types (type_code,type_name) VALUES
  ('RFQ','Request for Quotation'),('RFP','Request for Proposal'),
  ('RFI','Request for Information'),('TENDER','Public Tender'),('BID','General Bid')
ON CONFLICT DO NOTHING;

INSERT INTO bid_statuses (status_code,status_name,sort_order,color_hex) VALUES
  ('DRAFT','Draft',1,'#6B7280'),
  ('PENDING_APPROVAL','Pending Approval',2,'#F59E0B'),
  ('APPROVED','Approved',3,'#10B981'),
  ('PUBLISHED','Published',4,'#3B82F6'),
  ('OPEN','Open',5,'#06B6D4'),
  ('CLOSED','Closed',6,'#6B7280'),
  ('TECH_EVAL','Under Technical Evaluation',7,'#8B5CF6'),
  ('FIN_EVAL','Under Financial Evaluation',8,'#EC4899'),
  ('AWARDED','Awarded',9,'#16A34A'),
  ('CANCELLED','Cancelled',10,'#EF4444'),
  ('ARCHIVED','Archived',11,'#9CA3AF')
ON CONFLICT DO NOTHING;

INSERT INTO roles (role_code,role_name,description) VALUES
  ('ADMIN','Administrator','Full system access'),
  ('PROCUREMENT','Procurement Officer','Manage bids and procurement'),
  ('DEPT_MANAGER','Department Manager','Review and approve opportunities'),
  ('FINANCE','Finance Manager','Financial approval'),
  ('DIRECTOR','Director','Final approval authority'),
  ('EVALUATOR','Evaluator','Evaluate bids'),
  ('PRESALES','Presales Engineer','Technical evaluation'),
  ('SALES','Sales Representative','Manage opportunities')
ON CONFLICT DO NOTHING;

INSERT INTO departments (dept_code,dept_name) VALUES
  ('IT','Information Technology'),('PROC','Procurement'),
  ('FIN','Finance'),('SALES','Sales & Business Development'),
  ('PRESALES','Presales & Solutions'),('OPS','Operations')
ON CONFLICT DO NOTHING;

INSERT INTO procurement_categories (category_name) VALUES
  ('Telecommunications'),('ICT Infrastructure'),('Managed Services'),
  ('Security Solutions'),('Cloud Services'),('Network Equipment'),
  ('Software Licensing'),('Professional Services')
ON CONFLICT DO NOTHING;

-- ONE demo admin account (password = Admin@1234)
-- New users can register via the Sign Up page
INSERT INTO users (username,email,password_hash,full_name,dept_id,job_title,is_active)
VALUES ('admin','admin@telebid.com','$2b$12$0olx2C6eQwHi.upA6viguugX9VcyEFVwnDnoDub.jcIt24hQntwRK','System Administrator',2,'Administrator',TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id,role_id)
SELECT u.user_id, r.role_id FROM users u, roles r
WHERE u.username='admin' AND r.role_code='ADMIN'
ON CONFLICT DO NOTHING;

-- Vendors
INSERT INTO vendors (company_name,registration_no,contact_person,email,phone,business_category,vendor_rating,created_by) VALUES
  ('STC Business','KSA-2019-041','Ahmed Al-Saud','stc@stcbusiness.com','+966-11-000000','Telecommunications',4.5,1),
  ('Etisalat Enterprise','UAE-2020-082','Mohammed Al-Ali','info@etisalat.ae','+971-2-000000','Telecommunications',4.2,1),
  ('Orange Jordan','JOR-2020-055','Khaled Nassar','info@orange.jo','+962-6-000000','Telecommunications',4.7,1),
  ('Zain Business','KWT-2021-033','Fatima Al-Dosari','info@zain.com','+965-2-000000','Telecommunications',3.9,1),
  ('Cisco Systems','US-2015-001','John Smith','partners@cisco.com','+1-408-000000','ICT Infrastructure',4.8,1)
ON CONFLICT DO NOTHING;

-- Demo Bids
INSERT INTO bids (bid_number,bid_title,description,budget,currency_id,bid_source,bid_type_id,submission_deadline,status_id,created_by,qr_code_data)
SELECT 'BID-2026-00001','National Telecom Network Upgrade','Complete upgrade of national telecom backbone infrastructure',2500000,2,'INVITATION',
  (SELECT type_id FROM bid_types WHERE type_code='RFP'),
  NOW()+INTERVAL '30 days',
  (SELECT status_id FROM bid_statuses WHERE status_code='OPEN'), 1, 'BID-2026-00001'
WHERE NOT EXISTS (SELECT 1 FROM bids WHERE bid_number='BID-2026-00001');

INSERT INTO bids (bid_number,bid_title,description,budget,currency_id,bid_source,bid_type_id,submission_deadline,status_id,created_by,qr_code_data)
SELECT 'BID-2026-00002','Data Center Network Equipment Supply','Supply and installation of enterprise-grade network equipment',850000,2,'EMAIL',
  (SELECT type_id FROM bid_types WHERE type_code='RFQ'),
  NOW()+INTERVAL '14 days',
  (SELECT status_id FROM bid_statuses WHERE status_code='DRAFT'), 1, 'BID-2026-00002'
WHERE NOT EXISTS (SELECT 1 FROM bids WHERE bid_number='BID-2026-00002');

INSERT INTO bids (bid_number,bid_title,description,budget,currency_id,bid_source,bid_type_id,submission_deadline,status_id,created_by,qr_code_data)
SELECT 'BID-2026-00003','Managed Security Services Contract','3-year managed security services including SOC and SIEM',1200000,2,'INVITATION',
  (SELECT type_id FROM bid_types WHERE type_code='TENDER'),
  NOW()+INTERVAL '5 days',
  (SELECT status_id FROM bid_statuses WHERE status_code='TECH_EVAL'), 1, 'BID-2026-00003'
WHERE NOT EXISTS (SELECT 1 FROM bids WHERE bid_number='BID-2026-00003');

INSERT INTO bids (bid_number,bid_title,description,budget,currency_id,bid_source,bid_type_id,submission_deadline,status_id,created_by,qr_code_data)
SELECT 'BID-2026-00004','Internet & Anti-DDoS Services','Dedicated internet with anti-DDoS protection',180000,2,'EMAIL',
  (SELECT type_id FROM bid_types WHERE type_code='RFQ'),
  NOW()-INTERVAL '2 days',
  (SELECT status_id FROM bid_statuses WHERE status_code='OPEN'), 1, 'BID-2026-00004'
WHERE NOT EXISTS (SELECT 1 FROM bids WHERE bid_number='BID-2026-00004');

INSERT INTO bids (bid_number,bid_title,description,budget,currency_id,bid_source,bid_type_id,submission_deadline,status_id,created_by,qr_code_data)
SELECT 'BID-2026-00005','MPLS VPN for Branch Offices','Layer 3 MPLS VPN connecting 12 branch offices',320000,2,'INVITATION',
  (SELECT type_id FROM bid_types WHERE type_code='RFP'),
  NOW()+INTERVAL '21 days',
  (SELECT status_id FROM bid_statuses WHERE status_code='PENDING_APPROVAL'), 1, 'BID-2026-00005'
WHERE NOT EXISTS (SELECT 1 FROM bids WHERE bid_number='BID-2026-00005');

-- Demo Opportunities
INSERT INTO opportunities (opp_number,title,procurement_type,customer_name,sales_rep_id,presales_eng_id,submission_deadline,status,current_step,created_by)
SELECT 'OPP-2026-00001','Cairo Amman Bank - Network Modernization','RFP','Cairo Amman Bank',1,1,NOW()+INTERVAL '25 days','GO_APPROVED','PURCHASE_REQUEST',1
WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE opp_number='OPP-2026-00001');

INSERT INTO opportunities (opp_number,title,procurement_type,customer_name,sales_rep_id,presales_eng_id,submission_deadline,status,current_step,created_by)
SELECT 'OPP-2026-00002','Ministry of Digital Economy - Cloud Migration','TENDER','Ministry of Digital Economy',1,1,NOW()+INTERVAL '45 days','ASSIGNED_PRESALES','PRESALES_EVALUATION',1
WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE opp_number='OPP-2026-00002');

INSERT INTO opportunities (opp_number,title,procurement_type,customer_name,sales_rep_id,submission_deadline,status,current_step,created_by)
SELECT 'OPP-2026-00003','Aramex - SD-WAN Deployment','RFQ','Aramex Jordan',1,NOW()+INTERVAL '10 days','SUBMITTED','MANAGER_REVIEW',1
WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE opp_number='OPP-2026-00003');

-- Demo Notifications
INSERT INTO notifications (user_id,notif_type,title,body,is_read) VALUES
  (1,'BID_CREATED','New bid: National Telecom Network Upgrade','BID-2026-00001 is now open for vendor submissions',FALSE),
  (1,'DEADLINE_REMINDER','Deadline in 5 days: Managed Security Services','BID-2026-00003 closes soon',FALSE),
  (1,'OPP_APPROVED','Opportunity approved: Cairo Amman Bank','OPP-2026-00001 marked as Go',TRUE),
  (1,'BID_CREATED','New bid: MPLS VPN for Branch Offices','BID-2026-00005 awaiting your approval',FALSE)
ON CONFLICT DO NOTHING;

-- Demo Audit Logs
INSERT INTO audit_logs (user_id,username,action,module,record_type,action_at) VALUES
  (1,'admin','CREATE','BIDS','BID',NOW()-INTERVAL '5 days'),
  (1,'admin','CREATE','BIDS','BID',NOW()-INTERVAL '4 days'),
  (1,'admin','STATUS_CHANGE','BIDS','BID',NOW()-INTERVAL '3 days'),
  (1,'admin','CREATE','OPPORTUNITIES','OPPORTUNITY',NOW()-INTERVAL '2 days'),
  (1,'admin','LOGIN','AUTH','SESSION',NOW()-INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Watchlist (added for watchlist feature)
CREATE TABLE IF NOT EXISTS user_watchlist (
    user_id  INT NOT NULL REFERENCES users(user_id),
    bid_id   INT NOT NULL REFERENCES bids(bid_id),
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, bid_id)
);

-- ============================================================
-- MULTI-TENANT & SYSTEM SETTINGS EXTENSION
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
    company_id    SERIAL PRIMARY KEY,
    company_code  VARCHAR(20) UNIQUE NOT NULL,
    company_name  VARCHAR(200) NOT NULL,
    company_name_ar VARCHAR(200),
    address       TEXT,
    city          VARCHAR(100),
    country       VARCHAR(100),
    phone         VARCHAR(50),
    email         VARCHAR(150),
    website       VARCHAR(200),
    logo_url      VARCHAR(500),
    industry      VARCHAR(100),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
    setting_id    SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id),
    setting_key   VARCHAR(100) NOT NULL,
    setting_value TEXT,
    setting_type  VARCHAR(20) DEFAULT 'TEXT',
    category      VARCHAR(50),
    label         VARCHAR(200),
    description   TEXT,
    is_public     BOOLEAN DEFAULT FALSE,
    updated_by    INT REFERENCES users(user_id),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, setting_key)
);

CREATE TABLE IF NOT EXISTS dropdown_configs (
    dropdown_id   SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id),
    dropdown_key  VARCHAR(100) NOT NULL,
    dropdown_label VARCHAR(200) NOT NULL,
    option_value  VARCHAR(200) NOT NULL,
    option_label  VARCHAR(200) NOT NULL,
    option_label_ar VARCHAR(200),
    sort_order    INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, dropdown_key, option_value)
);

-- ============================================================
-- BID CATEGORIES (3 modules)
-- ============================================================

CREATE TABLE IF NOT EXISTS bid_modules (
    module_id     SERIAL PRIMARY KEY,
    module_code   VARCHAR(30) UNIQUE NOT NULL,
    module_name   VARCHAR(100) NOT NULL,
    module_name_ar VARCHAR(100),
    description   TEXT,
    icon          VARCHAR(50),
    sort_order    INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT TRUE
);

-- Extend bids table with new fields
ALTER TABLE bids ADD COLUMN IF NOT EXISTS module_id INT REFERENCES bid_modules(module_id);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS bid_category VARCHAR(50);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS organization VARCHAR(200);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS is_government BOOLEAN DEFAULT FALSE;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS bid_owner INT REFERENCES users(user_id);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(18,2);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
-- Location fields
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_name VARCHAR(300);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_address TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_city VARCHAR(100);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_country VARCHAR(100);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_lat NUMERIC(10,7);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_lng NUMERIC(10,7);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_source VARCHAR(50);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS location_confidence NUMERIC(3,2);

-- ============================================================
-- ICT MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS ict_categories (
    ict_cat_id    SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id),
    cat_code      VARCHAR(30) UNIQUE NOT NULL,
    cat_name      VARCHAR(100) NOT NULL,
    cat_name_ar   VARCHAR(100),
    description   TEXT,
    has_construction BOOLEAN DEFAULT FALSE,
    sort_order    INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ict_projects (
    ict_id        SERIAL PRIMARY KEY,
    bid_id        INT NOT NULL REFERENCES bids(bid_id),
    company_id    INT REFERENCES companies(company_id),
    ict_cat_id    INT NOT NULL REFERENCES ict_categories(ict_cat_id),
    project_type  VARCHAR(50),
    -- Construction-specific fields
    project_location TEXT,
    site_information TEXT,
    required_infrastructure TEXT,
    construction_requirements TEXT,
    technical_requirements TEXT,
    project_duration_days INT,
    project_duration_unit VARCHAR(20) DEFAULT 'DAYS',
    contractor_vendor VARCHAR(200),
    -- Common fields
    estimated_value NUMERIC(18,2),
    currency_id   INT REFERENCES currencies(currency_id),
    start_date    DATE,
    end_date      DATE,
    status        VARCHAR(30) DEFAULT 'DRAFT',
    notes         TEXT,
    created_by    INT NOT NULL REFERENCES users(user_id),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EXPRO LOG (configurable fields)
-- ============================================================

CREATE TABLE IF NOT EXISTS expro_field_definitions (
    field_def_id  SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id),
    field_key     VARCHAR(100) NOT NULL,
    field_label   VARCHAR(200) NOT NULL,
    field_label_ar VARCHAR(200),
    field_type    VARCHAR(30) DEFAULT 'TEXT',
    dropdown_key  VARCHAR(100),
    is_required   BOOLEAN DEFAULT FALSE,
    is_active     BOOLEAN DEFAULT TRUE,
    sort_order    INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, field_key)
);

CREATE TABLE IF NOT EXISTS expro_logs (
    expro_log_id  SERIAL PRIMARY KEY,
    bid_id        INT REFERENCES bids(bid_id),
    company_id    INT REFERENCES companies(company_id),
    log_reference VARCHAR(100),
    status        VARCHAR(30) DEFAULT 'DRAFT',
    submitted_by  INT REFERENCES users(user_id),
    submitted_at  TIMESTAMPTZ,
    reviewed_by   INT REFERENCES users(user_id),
    reviewed_at   TIMESTAMPTZ,
    notes         TEXT,
    created_by    INT NOT NULL REFERENCES users(user_id),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expro_log_values (
    value_id      SERIAL PRIMARY KEY,
    expro_log_id  INT NOT NULL REFERENCES expro_logs(expro_log_id),
    field_def_id  INT NOT NULL REFERENCES expro_field_definitions(field_def_id),
    field_key     VARCHAR(100) NOT NULL,
    field_value   TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BID LOGGING (separate logs per module)
-- ============================================================

CREATE TABLE IF NOT EXISTS bid_logs (
    bid_log_id    SERIAL PRIMARY KEY,
    bid_id        INT REFERENCES bids(bid_id),
    company_id    INT REFERENCES companies(company_id),
    module        VARCHAR(30) NOT NULL,
    action        VARCHAR(100) NOT NULL,
    description   TEXT,
    old_value     TEXT,
    new_value     TEXT,
    performed_by  INT NOT NULL REFERENCES users(user_id),
    ip_address    VARCHAR(50),
    reason        TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluation_logs (
    eval_log_id   SERIAL PRIMARY KEY,
    bid_eval_id   INT REFERENCES bid_evaluations(bid_eval_id),
    bid_id        INT REFERENCES bids(bid_id),
    action        VARCHAR(100) NOT NULL,
    description   TEXT,
    old_value     TEXT,
    new_value     TEXT,
    performed_by  INT NOT NULL REFERENCES users(user_id),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EXCEL IMPORT TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS excel_imports (
    import_id     SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id),
    file_name     VARCHAR(300) NOT NULL,
    import_type   VARCHAR(50) NOT NULL,
    total_rows    INT DEFAULT 0,
    imported      INT DEFAULT 0,
    skipped       INT DEFAULT 0,
    errors        INT DEFAULT 0,
    status        VARCHAR(20) DEFAULT 'PENDING',
    error_details TEXT,
    imported_by   INT NOT NULL REFERENCES users(user_id),
    imported_at   TIMESTAMPTZ DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

-- ============================================================
-- GLOBAL SEARCH INDEX (materialized view approach)
-- ============================================================

CREATE TABLE IF NOT EXISTS search_index (
    search_id     SERIAL PRIMARY KEY,
    company_id    INT,
    entity_type   VARCHAR(50) NOT NULL,
    entity_id     INT NOT NULL,
    title         VARCHAR(500),
    content       TEXT,
    url           VARCHAR(200),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_search_fts ON search_index USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));

-- ============================================================
-- SEED: Bid Modules (3 main categories)
-- ============================================================
INSERT INTO bid_modules (module_code, module_name, module_name_ar, description, icon, sort_order) VALUES
    ('TELECOM_EXPRO', 'Telecom — EXPRO / Government', 'اتصالات - اكسبرو / حكومي', 'Government and EXPRO-related telecom bids', 'Antenna', 1),
    ('TELECOM_NONGOVT', 'Telecom — Non-Government', 'اتصالات - غير حكومي', 'Private sector telecom bids', 'Radio', 2),
    ('NON_TELECOM', 'Non-Telecom', 'غير اتصالات', 'Non-telecommunications bids including ICT', 'Monitor', 3)
ON CONFLICT DO NOTHING;

-- Seed default ICT categories
INSERT INTO ict_categories (cat_code, cat_name, cat_name_ar, has_construction, sort_order) VALUES
    ('CONSTRUCTION',    'Construction',        'إنشاء',              TRUE,  1),
    ('INFRASTRUCTURE',  'Infrastructure',      'بنية تحتية',          FALSE, 2),
    ('NETWORKING',      'Networking',          'شبكات',              FALSE, 3),
    ('DATA_CENTER',     'Data Center',         'مركز بيانات',         FALSE, 4),
    ('CYBERSECURITY',   'Cybersecurity',       'أمن سيبراني',         FALSE, 5),
    ('TELECOM',         'Telecommunications',  'اتصالات',            FALSE, 6),
    ('SOFTWARE',        'Software',            'برمجيات',            FALSE, 7),
    ('HARDWARE',        'Hardware',            'أجهزة',              FALSE, 8),
    ('IT_SERVICES',     'IT Services',         'خدمات تقنية',         FALSE, 9),
    ('OTHER',           'Other ICT',           'أخرى',              FALSE, 10)
ON CONFLICT DO NOTHING;

-- Seed default company (single tenant for now)
INSERT INTO companies (company_code, company_name, country, is_active) VALUES
    ('DEFAULT', 'TeleBid Enterprise', 'Jordan', TRUE)
ON CONFLICT DO NOTHING;

-- Seed default system settings
INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label) VALUES
    (1, 'company_name',        'TeleBid Enterprise', 'TEXT',    'COMPANY',    'Company Name'),
    (1, 'company_name_ar',     'تيليبيد إنتربرايز',   'TEXT',    'COMPANY',    'Company Name (Arabic)'),
    (1, 'default_currency',    'USD',                'TEXT',    'FINANCE',    'Default Currency'),
    (1, 'date_format',         'DD MMM YYYY',        'TEXT',    'DISPLAY',    'Date Format'),
    (1, 'max_upload_mb',       '25',                 'NUMBER',  'SYSTEM',     'Max Upload Size (MB)'),
    (1, 'session_timeout_min', '60',                 'NUMBER',  'SECURITY',   'Session Timeout (Minutes)'),
    (1, 'otp_enabled',         'true',               'BOOLEAN', 'SECURITY',   'Enable OTP Login'),
    (1, 'google_maps_key',     '',                   'SECRET',  'INTEGRATIONS','Google Maps API Key'),
    (1, 'smtp_host',           '',                   'TEXT',    'EMAIL',      'SMTP Host'),
    (1, 'smtp_port',           '587',                'NUMBER',  'EMAIL',      'SMTP Port'),
    (1, 'smtp_user',           '',                   'TEXT',    'EMAIL',      'SMTP Username'),
    (1, 'smtp_password',       '',                   'SECRET',  'EMAIL',      'SMTP Password'),
    (1, 'eval_methodology',    'Weighted Score',     'TEXT',    'EVALUATION', 'Evaluation Methodology'),
    (1, 'ref_methodology',     'Direct Reference',   'TEXT',    'REFERENCE',  'Reference Methodology'),
    (1, 'bid_number_prefix',   'BID',               'TEXT',    'BIDS',       'Bid Number Prefix'),
    (1, 'expro_log_enabled',   'true',              'BOOLEAN', 'MODULES',    'Enable EXPRO Log Module')
ON CONFLICT DO NOTHING;

-- Seed default EXPRO field definitions
INSERT INTO expro_field_definitions (company_id, field_key, field_label, field_label_ar, field_type, is_required, sort_order) VALUES
    (1, 'expro_ref_number',    'EXPRO Reference Number',    'رقم مرجع اكسبرو',        'TEXT',     TRUE,  1),
    (1, 'contract_number',     'Contract Number',           'رقم العقد',              'TEXT',     FALSE, 2),
    (1, 'client_contact',      'Client Contact Person',     'مسؤول الاتصال',          'TEXT',     FALSE, 3),
    (1, 'scope_of_work',       'Scope of Work',             'نطاق العمل',             'TEXTAREA', FALSE, 4),
    (1, 'project_phase',       'Project Phase',             'مرحلة المشروع',          'DROPDOWN', FALSE, 5),
    (1, 'bid_bond_required',   'Bid Bond Required',         'ضمان العطاء مطلوب',      'BOOLEAN',  FALSE, 6),
    (1, 'bid_bond_value',      'Bid Bond Value',            'قيمة ضمان العطاء',       'NUMBER',   FALSE, 7),
    (1, 'performance_bond',    'Performance Bond %',        'ضمان الأداء %',          'NUMBER',   FALSE, 8),
    (1, 'liquidated_damages',  'Liquidated Damages %',      'الغرامات التأخيرية %',   'NUMBER',   FALSE, 9),
    (1, 'payment_terms',       'Payment Terms',             'شروط الدفع',             'DROPDOWN', FALSE, 10),
    (1, 'delivery_location',   'Delivery Location',         'موقع التسليم',           'TEXT',     FALSE, 11),
    (1, 'technical_standards', 'Technical Standards',       'المعايير التقنية',       'TEXT',     FALSE, 12),
    (1, 'local_content_req',   'Local Content Requirement', 'متطلبات المحتوى المحلي', 'NUMBER',   FALSE, 13),
    (1, 'hse_requirements',    'HSE Requirements',          'متطلبات السلامة',        'TEXTAREA', FALSE, 14),
    (1, 'prequalification',    'Pre-Qualification Status',  'حالة التأهيل المسبق',    'DROPDOWN', FALSE, 15)
ON CONFLICT DO NOTHING;

-- Seed dropdown configs for EXPRO
INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, sort_order) VALUES
    (1, 'project_phase', 'Project Phase', 'CONCEPT',     'Concept',       1),
    (1, 'project_phase', 'Project Phase', 'FEASIBILITY', 'Feasibility',   2),
    (1, 'project_phase', 'Project Phase', 'FEED',        'FEED',          3),
    (1, 'project_phase', 'Project Phase', 'DETAILED',    'Detailed Design',4),
    (1, 'project_phase', 'Project Phase', 'EXECUTION',   'Execution',     5),
    (1, 'project_phase', 'Project Phase', 'COMMISSIONING','Commissioning', 6),
    (1, 'payment_terms', 'Payment Terms', 'NET30',       'Net 30 Days',   1),
    (1, 'payment_terms', 'Payment Terms', 'NET60',       'Net 60 Days',   2),
    (1, 'payment_terms', 'Payment Terms', 'NET90',       'Net 90 Days',   3),
    (1, 'payment_terms', 'Payment Terms', 'MILESTONE',   'Milestone Based',4),
    (1, 'payment_terms', 'Payment Terms', 'ADVANCE',     'Advance Payment',5),
    (1, 'prequalification','Pre-Qualification Status','APPROVED','Approved',1),
    (1, 'prequalification','Pre-Qualification Status','PENDING','Pending',  2),
    (1, 'prequalification','Pre-Qualification Status','NOT_REQUIRED','Not Required',3)
ON CONFLICT DO NOTHING;

-- ============================================================
-- EXPRO BID MANAGEMENT EXTENSION (from Excel analysis)
-- ============================================================

-- Solution families (Connectivity, ICT, Mobility, Security, etc.)
CREATE TABLE IF NOT EXISTS solution_families (
    family_id    SERIAL PRIMARY KEY,
    company_id   INT REFERENCES companies(company_id) DEFAULT 1,
    family_code  VARCHAR(50) UNIQUE NOT NULL,
    family_name  VARCHAR(100) NOT NULL,
    family_name_ar VARCHAR(100),
    sort_order   INT DEFAULT 0,
    is_active    BOOLEAN DEFAULT TRUE
);

-- Solution types (BDI, L2, L3, VSAT, SIP Trunk, etc.)
CREATE TABLE IF NOT EXISTS solution_types (
    solution_id   SERIAL PRIMARY KEY,
    company_id    INT REFERENCES companies(company_id) DEFAULT 1,
    family_id     INT REFERENCES solution_families(family_id),
    solution_code VARCHAR(50) NOT NULL,
    solution_name VARCHAR(150) NOT NULL,
    solution_name_ar VARCHAR(150),
    sort_order    INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT TRUE
);

-- Full opportunity/RFP record (from both Excel files combined)
CREATE TABLE IF NOT EXISTS opportunities_v2 (
    opp_id           SERIAL PRIMARY KEY,
    company_id       INT REFERENCES companies(company_id) DEFAULT 1,
    -- Reference Numbers
    opp_number       VARCHAR(50) UNIQUE NOT NULL,
    expro_ref        VARCHAR(50),
    rfp_ref          VARCHAR(100),
    -- Customer
    customer_name    VARCHAR(200),
    customer_name_ar VARCHAR(200),
    customer_id      VARCHAR(100),
    customer_type    VARCHAR(20) DEFAULT 'CORPORATE',  -- CORPORATE, GOVERNMENT
    is_strategic     BOOLEAN DEFAULT FALSE,
    -- RFP Source (checkboxes - multiple can be true)
    source_customer_rfp  BOOLEAN DEFAULT FALSE,
    source_government    BOOLEAN DEFAULT FALSE,
    source_etimad        BOOLEAN DEFAULT FALSE,
    source_expro         BOOLEAN DEFAULT FALSE,
    source_forsah        BOOLEAN DEFAULT FALSE,
    source_wholesales    BOOLEAN DEFAULT FALSE,
    project_type     VARCHAR(100),  -- e.g. "Corporate- Email Invitation"
    -- Solution
    family_id        INT REFERENCES solution_families(family_id),
    solution_id      INT REFERENCES solution_types(solution_id),
    solution_detail  VARCHAR(200),  -- SOW / L3 IPVPN, BDI etc.
    -- Telecom Specifics (from File 1)
    media_type       VARCHAR(30),   -- Fiber, MW, 5G, VSAT
    sla_type         VARCHAR(30),   -- Premium, Standard
    bandwidth_mbps   NUMERIC(10,2),
    quantity         INT DEFAULT 1,
    contract_duration VARCHAR(50),  -- "12 Months", "3 Years"
    coverage_study   VARCHAR(100),  -- TLS, add on
    -- Financial
    nrc              NUMERIC(18,2),
    mrc              NUMERIC(18,2),
    tcv              NUMERIC(18,2),
    currency_id      INT REFERENCES currencies(currency_id) DEFAULT 1,
    project_size     VARCHAR(10),   -- SMALL, MEDIUM, LARGE
    -- Description
    description      TEXT,
    sow_detail       TEXT,
    location_text    VARCHAR(300),
    attachment_url   VARCHAR(500),
    notes            TEXT,
    -- People
    sales_rep_id     INT REFERENCES users(user_id),
    presales_id      INT REFERENCES users(user_id),
    bid_manager_id   INT REFERENCES users(user_id),
    -- Comments per role
    presales_comments TEXT,
    sales_comments    TEXT,
    bid_comments      TEXT,
    finance_comments  TEXT,
    -- Deadlines
    rfp_issue_date        DATE,
    questions_deadline    TIMESTAMPTZ,
    submission_deadline   TIMESTAMPTZ,
    expected_award_date   DATE,
    -- Status & Tracking
    phase            VARCHAR(50) DEFAULT 'Draft',
    status           VARCHAR(30) DEFAULT 'DRAFT',
    -- Won fields
    won_date         DATE,
    order_number     VARCHAR(100),
    order_summary    TEXT,
    -- Lost fields
    lost_date        DATE,
    loss_reason      VARCHAR(200),
    loss_type        VARCHAR(30),   -- TECHNICAL, FINANCIAL, CANCELLED
    competitor_name  VARCHAR(200),
    winner_name      VARCHAR(200),
    winner_tcv       NUMERIC(18,2),
    -- System
    created_by       INT NOT NULL REFERENCES users(user_id),
    updated_by       INT REFERENCES users(user_id),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    is_deleted       BOOLEAN DEFAULT FALSE
);

-- Multi-level approval workflow
CREATE TABLE IF NOT EXISTS opportunity_approvals (
    approval_id      SERIAL PRIMARY KEY,
    opp_id           INT NOT NULL REFERENCES opportunities_v2(opp_id),
    approval_level   INT NOT NULL,           -- 1, 2, 3
    approver_id      INT REFERENCES users(user_id),
    approver_name    VARCHAR(200),
    approver_position VARCHAR(100),
    status           VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, APPROVED, REJECTED, CHANGES_REQUESTED
    comments         TEXT,
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    is_locked        BOOLEAN DEFAULT FALSE    -- cannot be edited after decision
);

-- Deadline tracking with reminders
CREATE TABLE IF NOT EXISTS opportunity_deadlines (
    deadline_id      SERIAL PRIMARY KEY,
    opp_id           INT NOT NULL REFERENCES opportunities_v2(opp_id),
    deadline_type    VARCHAR(50) NOT NULL,   -- RFP_ISSUE, QUESTIONS, SUBMISSION, AWARD, OTHER
    deadline_label   VARCHAR(100),
    deadline_label_ar VARCHAR(100),
    deadline_dt      TIMESTAMPTZ,
    responsible_id   INT REFERENCES users(user_id),
    reminder_sent    BOOLEAN DEFAULT FALSE,
    reminder_days_before INT DEFAULT 3,
    status           VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, OVERDUE, COMPLETED
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Opportunity audit log
CREATE TABLE IF NOT EXISTS opportunity_logs (
    log_id       SERIAL PRIMARY KEY,
    opp_id       INT NOT NULL REFERENCES opportunities_v2(opp_id),
    action       VARCHAR(100) NOT NULL,
    field_name   VARCHAR(100),
    old_value    TEXT,
    new_value    TEXT,
    performed_by INT NOT NULL REFERENCES users(user_id),
    performed_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address   VARCHAR(50),
    comments     TEXT
);

-- ============================================================
-- SEED: Solution Families
-- ============================================================
INSERT INTO solution_families (family_code, family_name, family_name_ar, sort_order) VALUES
    ('CONNECTIVITY',  'Connectivity',   'الاتصالية',          1),
    ('MOBILITY',      'Mobility',       'الجوال',            2),
    ('CYBER_SECURITY','Cyber Security', 'الأمن السيبراني',    3),
    ('OTHER_ICT',     'Other ICT',      'تقنية المعلومات',    4),
    ('HOSTED_SERVICES','Hosted Services','الخدمات المستضافة',  5),
    ('IT',            'IT',             'تقنية المعلومات',    6)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Solution Types (from Excel data)
-- ============================================================
INSERT INTO solution_types (family_id, solution_code, solution_name, sort_order)
SELECT f.family_id, s.code, s.name, s.sort
FROM (VALUES
    ('CONNECTIVITY', 'BDI',           'BDI',                           1),
    ('CONNECTIVITY', 'BDI_MRS',       'BDI with MRS',                  2),
    ('CONNECTIVITY', 'EBDI',          'EBDI',                          3),
    ('CONNECTIVITY', 'EBDI_MRS',      'EBDI with MRS',                 4),
    ('CONNECTIVITY', 'L2',            'L2',                            5),
    ('CONNECTIVITY', 'L2_MRS',        'L2 with MRS',                   6),
    ('CONNECTIVITY', 'L3',            'L3 (IPVPN)',                    7),
    ('CONNECTIVITY', 'L3_MRS',        'L3 with MRS',                   8),
    ('CONNECTIVITY', 'INTERNET',      'Internet & Connectivity',        9),
    ('CONNECTIVITY', 'INTERNET_MRS',  'Internet & Connectivity with MRS', 10),
    ('CONNECTIVITY', 'SIP_TRUNK',     'SIP Trunk',                    11),
    ('CONNECTIVITY', 'SIP_TRUNK_MRS', 'SIP Trunk with MRS',           12),
    ('CONNECTIVITY', 'DWDM',          'DWDM',                         13),
    ('CONNECTIVITY', 'GMPLS',         'GMPLS',                        14),
    ('CONNECTIVITY', 'VSAT',          'VSAT',                         15),
    ('MOBILITY',     'EBDI_MOB',      'EBDI (Mobility)',               1),
    ('CYBER_SECURITY','CS_L2',        'L2 (Security)',                  1),
    ('OTHER_ICT',    'NET_INFRA',     'Network Infrastructure',         1),
    ('OTHER_ICT',    'VSAT_ICT',      'VSAT (ICT)',                    2)
) AS s(family_code, code, name, sort)
JOIN solution_families f ON f.family_code = s.family_code
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Dropdown configs from Excel data
-- ============================================================
INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, sort_order) VALUES
    -- Project Types / Sources
    (1, 'project_type', 'Project Type', 'CORP_EMAIL',    'Corporate — Email Invitation', 1),
    (1, 'project_type', 'Project Type', 'GOVT_EMAIL',    'Government — Email Invitation',2),
    (1, 'project_type', 'Project Type', 'GOVT_ETIMAD',   'Government — Etimad',          3),
    (1, 'project_type', 'Project Type', 'CORP_ETIMAD',   'Corporate — Etimad',           4),
    (1, 'project_type', 'Project Type', 'GOVT_FORSAH',   'Government — Forsah',          5),
    (1, 'project_type', 'Project Type', 'CORP_FORSAH',   'Corporate — Forsah',           6),
    (1, 'project_type', 'Project Type', 'WHOLESALES',    'Wholesales',                   7),
    (1, 'project_type', 'Project Type', 'EXPRO',         'EXPRO',                        8),
    -- Media Types
    (1, 'media_type',  'Media Type',   'FIBER',  'Fiber',  1),
    (1, 'media_type',  'Media Type',   'MW',     'MW',     2),
    (1, 'media_type',  'Media Type',   '5G',     '5G',     3),
    (1, 'media_type',  'Media Type',   'VSAT',   'VSAT',   4),
    -- SLA Types
    (1, 'sla_type',    'SLA',          'PREMIUM',   'Premium',   1),
    (1, 'sla_type',    'SLA',          'STANDARD',  'Standard',  2),
    -- Project Size
    (1, 'project_size','Project Size', 'SMALL',   'Small',   1),
    (1, 'project_size','Project Size', 'MEDIUM',  'Medium',  2),
    (1, 'project_size','Project Size', 'LARGE',   'Large',   3),
    -- Phase
    (1, 'opp_phase',   'Phase',        'DRAFT',        'Draft',            1),
    (1, 'opp_phase',   'Phase',        'ONGOING',      'On Going',         2),
    (1, 'opp_phase',   'Phase',        'SUBMITTED',    'Submitted',        3),
    (1, 'opp_phase',   'Phase',        'WIP',          'Work In Progress', 4),
    (1, 'opp_phase',   'Phase',        'NEGOTIATION',  'Negotiation',      5),
    (1, 'opp_phase',   'Phase',        'DROPPED',      'Dropped',          6),
    -- Status
    (1, 'opp_status',  'Status',       'DRAFT',           'Draft',               1),
    (1, 'opp_status',  'Status',       'PENDING_L1',      'Pending L1 Approval', 2),
    (1, 'opp_status',  'Status',       'PENDING_L2',      'Pending L2 Approval', 3),
    (1, 'opp_status',  'Status',       'PENDING_L3',      'Pending L3 Approval', 4),
    (1, 'opp_status',  'Status',       'APPROVED',        'Approved',            5),
    (1, 'opp_status',  'Status',       'CHANGES_REQUESTED','Changes Requested',  6),
    (1, 'opp_status',  'Status',       'SUBMITTED_CUST',  'Submitted to Customer',7),
    (1, 'opp_status',  'Status',       'PENDING',         'Pending',             8),
    (1, 'opp_status',  'Status',       'WON',             'Won',                 9),
    (1, 'opp_status',  'Status',       'LOST',            'Lost',               10),
    (1, 'opp_status',  'Status',       'DROPPED',         'Dropped',            11),
    (1, 'opp_status',  'Status',       'CANCELLED',       'Cancelled',          12),
    -- Loss Reasons
    (1, 'loss_reason', 'Loss Reason',  'NO_COVERAGE',  'No Coverage',             1),
    (1, 'loss_reason', 'Loss Reason',  'WRONG_REQ',    'Wrong Request',           2),
    (1, 'loss_reason', 'Loss Reason',  'COMPETITOR',   'Lost to Competitor',      3),
    (1, 'loss_reason', 'Loss Reason',  'TECHNICAL',    'Lost Technical',          4),
    (1, 'loss_reason', 'Loss Reason',  'FINANCIAL',    'Lost Financial',          5),
    (1, 'loss_reason', 'Loss Reason',  'CANCELLED_CLIENT','Cancelled by Client',  6),
    (1, 'loss_reason', 'Loss Reason',  'OUT_OF_SCOPE', 'Out of Scope',            7),
    (1, 'loss_reason', 'Loss Reason',  'NO_PARTNER',   'No Partnership',          8),
    (1, 'loss_reason', 'Loss Reason',  'OTHER',        'Other',                   9)
ON CONFLICT DO NOTHING;

-- ============================================================
-- NEW: Employee extended profile (initials, sectors)
-- ============================================================
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS initials        VARCHAR(10),
    ADD COLUMN IF NOT EXISTS sectors_covered TEXT,        -- comma-separated or JSON array
    ADD COLUMN IF NOT EXISTS employee_type2  VARCHAR(20); -- allow BOTH Sales+PreSales

-- ============================================================
-- NEW: Opportunity team members (multiple sales/presales per opp)
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_team (
    team_id      SERIAL PRIMARY KEY,
    opp_id       INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
    emp_id       INT NOT NULL REFERENCES employees(emp_id),
    role         VARCHAR(20) NOT NULL CHECK (role IN ('SALES','PRESALES','BID_MANAGER','FINANCE')),
    -- Snapshotted at time of assignment (in case employee profile changes)
    full_name    VARCHAR(150),
    initials     VARCHAR(10),
    job_title    VARCHAR(100),
    sectors      TEXT,
    notes        TEXT,
    added_at     TIMESTAMPTZ DEFAULT NOW(),
    added_by     INT REFERENCES users(user_id),
    UNIQUE (opp_id, emp_id, role)
);

-- ============================================================
-- NEW: EXPRO Feasibility Study (Section 9)
-- ============================================================
CREATE TABLE IF NOT EXISTS expro_feasibility (
    feasibility_id  SERIAL PRIMARY KEY,
    opp_id          INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
    -- Sales side
    sales_emp_id    INT REFERENCES employees(emp_id),
    sales_name      VARCHAR(150),
    sales_initials  VARCHAR(10),
    sales_title     VARCHAR(100),
    sales_sectors   TEXT,
    sales_notes     TEXT,
    -- Pre-Sales side
    presales_emp_id INT REFERENCES employees(emp_id),
    presales_name   VARCHAR(150),
    presales_initials VARCHAR(10),
    presales_title  VARCHAR(100),
    presales_sectors TEXT,
    presales_notes  TEXT,
    -- Feasibility outcome
    feasibility_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, FEASIBLE, NOT_FEASIBLE, PARTIAL
    feasibility_notes  TEXT,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (opp_id)   -- one feasibility record per opportunity
);

-- ============================================================
-- NEW: Opportunity questions with deadlines
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_questions (
    question_id  SERIAL PRIMARY KEY,
    opp_id       INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    assigned_to  INT REFERENCES users(user_id),
    deadline_dt  TIMESTAMPTZ,
    status       VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, ANSWERED, OVERDUE, CLOSED
    response     TEXT,
    responded_at TIMESTAMPTZ,
    responded_by INT REFERENCES users(user_id),
    priority     VARCHAR(10) DEFAULT 'NORMAL', -- LOW, NORMAL, HIGH, URGENT
    created_by   INT NOT NULL REFERENCES users(user_id),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NEW: Customer Reference Configuration (per company)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_ref_config (
    config_id         SERIAL PRIMARY KEY,
    company_id        INT REFERENCES companies(company_id) DEFAULT 1,
    use_company_initials  BOOLEAN DEFAULT FALSE,
    use_presales_initials BOOLEAN DEFAULT TRUE,
    use_cash              BOOLEAN DEFAULT FALSE,
    use_customer_id       BOOLEAN DEFAULT TRUE,
    separator             VARCHAR(5) DEFAULT '-',
    company_initials      VARCHAR(10) DEFAULT 'SLM',
    cash_label            VARCHAR(20) DEFAULT 'CASH',
    require_unique        BOOLEAN DEFAULT TRUE,
    preview_example       VARCHAR(200),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id)
);

-- Seed default reference config
INSERT INTO customer_ref_config (company_id, use_company_initials, use_presales_initials, use_cash, use_customer_id, company_initials)
VALUES (1, FALSE, TRUE, FALSE, TRUE, 'SLM')
ON CONFLICT DO NOTHING;

-- Add customer_ref column to opportunities_v2 if missing
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS customer_ref        VARCHAR(200),
    ADD COLUMN IF NOT EXISTS sales_initials      VARCHAR(10),
    ADD COLUMN IF NOT EXISTS presales_initials   VARCHAR(10),
    ADD COLUMN IF NOT EXISTS questions_count     INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS questions_open      INT DEFAULT 0;

-- ============================================================
-- FROM IMAGES: Extended Reference Model Config
-- ============================================================
ALTER TABLE customer_ref_config
    ADD COLUMN IF NOT EXISTS use_am_initials       BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS use_client_initials    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS use_version            BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS version_label          VARCHAR(10) DEFAULT '1.x',
    ADD COLUMN IF NOT EXISTS ref_number_prefix      VARCHAR(20) DEFAULT '';

-- ============================================================
-- FROM IMAGES: Company Activation Code
-- ============================================================
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS activation_code  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS company_initials VARCHAR(10);

-- ============================================================
-- FROM IMAGES: Bonds (New Bond -> Bid Bond -> Final Bond)
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_bonds (
    bond_id        SERIAL PRIMARY KEY,
    opp_id         INT NOT NULL REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
    bond_type      VARCHAR(20) NOT NULL CHECK (bond_type IN ('NEW_BOND','BID_BOND','FINAL_BOND')),
    bond_number    VARCHAR(100),
    bond_amount    NUMERIC(18,2),
    currency_id    INT REFERENCES currencies(currency_id) DEFAULT 1,
    issue_date     DATE,
    expiry_date    DATE,
    issuer_bank    VARCHAR(200),
    beneficiary    VARCHAR(200),
    status         VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, ISSUED, EXPIRED, CANCELLED, RELEASED
    notes          TEXT,
    approved_by    INT REFERENCES users(user_id),
    approved_at    TIMESTAMPTZ,
    created_by     INT NOT NULL REFERENCES users(user_id),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FROM IMAGES: RFP Source is single-select (radio), not multi-check
-- Add source_single column to opportunities_v2
-- ============================================================
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS source_single  VARCHAR(20),  -- ETIMAD, EMAIL, CLIENT, PORTAL
    ADD COLUMN IF NOT EXISTS am_initials    VARCHAR(10),   -- Account Manager initials for ref
    ADD COLUMN IF NOT EXISTS client_initials VARCHAR(10),  -- Client initials for ref
    ADD COLUMN IF NOT EXISTS ref_version    VARCHAR(10),   -- version e.g. 1.x
    ADD COLUMN IF NOT EXISTS bond_required  BOOLEAN DEFAULT FALSE;

-- ============================================================
-- FROM IMAGES: Service Type 2-level hierarchy for NEW RFP
-- Telecom L1: Mobility, Internet, Connectivity (up to 4)
-- ICT L1: Infrastructure, End User, Software, Others, Managed Srvc (up to 5, +4 custom)
-- Already handled by solution_families + solution_types tables
-- Add explicit hierarchy support
-- ============================================================
CREATE TABLE IF NOT EXISTS service_categories (
    cat_id       SERIAL PRIMARY KEY,
    company_id   INT REFERENCES companies(company_id) DEFAULT 1,
    parent_id    INT REFERENCES service_categories(cat_id),
    service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('TELECOM','ICT')),
    cat_name     VARCHAR(100) NOT NULL,
    cat_name_ar  VARCHAR(100),
    level        INT DEFAULT 1,   -- 1=top, 2=sub, etc.
    sort_order   INT DEFAULT 0,
    is_active    BOOLEAN DEFAULT TRUE,
    is_not_applicable BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Telecom categories
INSERT INTO service_categories (service_type, cat_name, level, sort_order) VALUES
    ('TELECOM','Mobility',1,1),
    ('TELECOM','Internet',1,2),
    ('TELECOM','Connectivity',1,3)
ON CONFLICT DO NOTHING;

-- Seed ICT categories
INSERT INTO service_categories (service_type, cat_name, level, sort_order) VALUES
    ('ICT','Infrastructure',1,1),
    ('ICT','End User',1,2),
    ('ICT','Software',1,3),
    ('ICT','Managed Services',1,4),
    ('ICT','Others',1,5)
ON CONFLICT DO NOTHING;

-- Add service cat to opportunity
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS service_type     VARCHAR(10),  -- TELECOM or ICT
    ADD COLUMN IF NOT EXISTS service_cat_l1   INT REFERENCES service_categories(cat_id),
    ADD COLUMN IF NOT EXISTS service_cat_l2   INT REFERENCES service_categories(cat_id);

-- ============================================================
-- FROM IMAGES: Account Managers config in Company Settings
-- ============================================================
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

-- ============================================================
-- FROM IMAGES: Bid Specialists / Managers config
-- ============================================================
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

-- ============================================================
-- Bond Reminder Tracking (bond_required per opportunity)
-- ============================================================
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS bond_reminder_sent    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bond_reminder_sent_at TIMESTAMPTZ;

-- Track who is the "manager" to notify for bond reminders
-- Uses bid_manager_id already on opportunities_v2
-- We also need to resolve the manager of the bid person (sales_rep_id -> their dept manager)
-- For now, manager_id column:
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES users(user_id);

-- ============================================================
-- WON OPPORTUNITY WORKFLOW
-- Triggered when opportunity status changes to WON.
-- Original opportunity is preserved. A WON record is created
-- that copies all fields + adds WON-specific Bid Person inputs.
-- ============================================================

-- Status values for the EXPLORED → WON workflow (per spec)
-- Pending | Lost Financially | Lost Technical | Won
-- These are stored in dropdown_configs under 'explored_status'
INSERT INTO dropdown_configs (company_id, dropdown_key, dropdown_label, option_value, option_label, sort_order) VALUES
    (1, 'explored_status', 'Explored Status', 'PENDING',          'Pending',           1),
    (1, 'explored_status', 'Explored Status', 'LOST_FINANCIALLY',  'Lost Financially',  2),
    (1, 'explored_status', 'Explored Status', 'LOST_TECHNICAL',    'Lost Technical',    3),
    (1, 'explored_status', 'Explored Status', 'WON',               'Won',               4)
ON CONFLICT DO NOTHING;

-- WON Records table
-- Copies opportunity data + adds WON-specific fields filled by Bid Person
CREATE TABLE IF NOT EXISTS won_records (
    won_id           SERIAL PRIMARY KEY,
    -- Link back to original opportunity (preserved for history)
    opp_id           INT NOT NULL REFERENCES opportunities_v2(opp_id),
    won_number       VARCHAR(50) UNIQUE NOT NULL,  -- e.g. WON-2026-00001
    company_id       INT REFERENCES companies(company_id) DEFAULT 1,

    -- ── COPIED FROM OPPORTUNITY (read-only in WON form) ──────────
    expro_ref        VARCHAR(50),
    po_number        VARCHAR(100),     -- PO# from opportunity (rfp_ref)
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

    -- ── FILLED BY BID PERSON (required WON inputs) ───────────────
    po_date          DATE,             -- required
    discount_applied NUMERIC(5,2),     -- percentage e.g. 10.50
    discount_amount  NUMERIC(18,2),    -- calculated: tcv * discount / 100
    final_value      NUMERIC(18,2),    -- tcv after discount
    won_date         DATE NOT NULL,    -- required
    order_number     VARCHAR(100),     -- PO/Order reference
    order_summary    TEXT,             -- summary of what was won
    -- Invoice fields
    invoice_status   VARCHAR(30) DEFAULT 'NOT_INVOICED',  -- NOT_INVOICED, PARTIAL, INVOICED, PAID
    invoice_number   VARCHAR(100),
    invoice_date     DATE,
    invoice_amount   NUMERIC(18,2),
    payment_terms    VARCHAR(100),     -- e.g. "Net 30", "50% upfront"
    -- Additional Bid Person notes
    bid_person_notes TEXT,
    -- Internal status of WON record
    won_status       VARCHAR(30) DEFAULT 'ACTIVE',  -- ACTIVE, CANCELLED, COMPLETED

    -- ── SYSTEM FIELDS ────────────────────────────────────────────
    won_by           INT NOT NULL REFERENCES users(user_id),  -- who triggered WON
    completed_by     INT REFERENCES users(user_id),           -- who completed the form
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    is_deleted       BOOLEAN DEFAULT FALSE,

    -- Prevent duplicate WON records for same opportunity
    CONSTRAINT one_won_per_opp UNIQUE (opp_id)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_won_opp_id ON won_records(opp_id);
CREATE INDEX IF NOT EXISTS idx_won_status ON won_records(won_status);

-- ============================================================
-- PHASE 1 FIXES: LOST workflow, SMTP settings
-- ============================================================
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
CREATE INDEX IF NOT EXISTS idx_lost_opp_id ON lost_records(opp_id);

INSERT INTO system_settings (company_id, setting_key, setting_value, setting_type, category, label)
VALUES
    (1,'smtp_from_name','TeleBid Enterprise','TEXT','EMAIL','From Name'),
    (1,'smtp_from_email','','TEXT','EMAIL','From Email'),
    (1,'smtp_use_tls','true','BOOL','EMAIL','Use TLS'),
    (1,'email_enabled','false','BOOL','EMAIL','Enable Email Sending')
ON CONFLICT DO NOTHING;

ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS bond_required       BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bond_reminder_sent  BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bond_reminder_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS manager_id          INT REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS source_single       VARCHAR(20),
    ADD COLUMN IF NOT EXISTS service_type        VARCHAR(10),
    ADD COLUMN IF NOT EXISTS service_cat_l1      INT REFERENCES service_categories(cat_id),
    ADD COLUMN IF NOT EXISTS service_cat_l2      INT REFERENCES service_categories(cat_id),
    ADD COLUMN IF NOT EXISTS am_initials         VARCHAR(10),
    ADD COLUMN IF NOT EXISTS client_initials     VARCHAR(10),
    ADD COLUMN IF NOT EXISTS ref_version         VARCHAR(10),
    ADD COLUMN IF NOT EXISTS customer_ref        VARCHAR(200),
    ADD COLUMN IF NOT EXISTS questions_count     INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS questions_open      INT DEFAULT 0;

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS initials        VARCHAR(10),
    ADD COLUMN IF NOT EXISTS sectors_covered TEXT,
    ADD COLUMN IF NOT EXISTS employee_type2  VARCHAR(20);

-- explored_status options are already seeded above (dropdown_configs UNIQUE
-- constraint on company_id/dropdown_key/option_value makes re-seeding here
-- a safe no-op, so this duplicate block was removed rather than kept).

-- Ensure admin has OTP disabled by default (enable after configuring SMTP)
UPDATE users SET otp_enabled=FALSE WHERE username='admin';

-- ============================================================
-- EXPRO / AUTHORITY APPROVAL — CONFIGURABLE GATE
-- source_expro (above) only ever recorded that EXPRO applied; nothing
-- enforced it, so a tender could reach WON with no approved EXPRO log.
-- expro_required makes the authority stage an explicit, per-opportunity
-- toggle (never assumed) that mark_won checks before allowing an award.
-- ============================================================
ALTER TABLE opportunities_v2
    ADD COLUMN IF NOT EXISTS expro_required BOOLEAN DEFAULT FALSE;

-- ============================================================
-- AI BID/NO-BID ADVISOR
-- One row per generated recommendation (kept, not overwritten, so the
-- history of what the AI advised — and when — is auditable alongside the
-- human decision actually made on the opportunity).
-- ============================================================
CREATE TABLE IF NOT EXISTS opp_ai_insights (
    insight_id      SERIAL PRIMARY KEY,
    opp_id          INT NOT NULL REFERENCES opportunities_v2(opp_id),
    recommendation  VARCHAR(20) NOT NULL,   -- BID, NO_BID, CONDITIONAL_BID
    confidence      INT,                    -- 0-100
    key_strengths   TEXT,                   -- JSON-encoded string list
    key_risks       TEXT,                   -- JSON-encoded string list
    reasoning       TEXT,
    model_used      VARCHAR(50),
    generated_by    INT REFERENCES users(user_id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opp_ai_insights_opp ON opp_ai_insights(opp_id, created_at DESC);

-- ============================================================
-- MULTI-TENANCY CONVERSION
-- Every company that signs up gets its own row in `companies` and every
-- user/record belongs to exactly one. Before this, `company_id=1` was the
-- only company that ever existed and almost nothing filtered by it, so any
-- second tenant's data would have been visible to everyone. This migration
-- is additive and non-destructive: every existing row is backfilled to
-- company_id=1 (the original seeded "TeleBid Enterprise" tenant) before
-- NOT NULL is enforced, so nothing here can lose data.
-- ============================================================

-- users: the core identity/tenant link. Also add is_platform_admin now
-- (unused, no UI yet) so a future cross-tenant support view doesn't require
-- re-touching every endpoint that gets converted below.
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE;
UPDATE users SET company_id = 1 WHERE company_id IS NULL;
ALTER TABLE users ALTER COLUMN company_id SET NOT NULL;

-- Tables with no company_id column at all today.
ALTER TABLE vendors             ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE opportunities       ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE evaluation_templates ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE evaluation_criteria ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE bid_evaluations     ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE evaluation_scores   ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE contracts           ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE opportunity_bonds   ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE invitations         ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE documents           ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE notifications       ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE audit_logs          ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE employees           ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE company_references  ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE purchase_requests   ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE approvals           ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE comments            ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);
ALTER TABLE vendor_performance  ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(company_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors','opportunities','evaluation_templates','evaluation_criteria',
    'bid_evaluations','evaluation_scores','contracts','opportunity_bonds',
    'invitations','documents','notifications','audit_logs','employees',
    'company_references','purchase_requests','approvals','comments',
    'vendor_performance',
    -- Tables that already had a company_id column but were never backfilled
    -- or enforced NOT NULL: bids (added via ALTER earlier in this file),
    -- and everything below.
    'bids','ict_categories','ict_projects','expro_field_definitions',
    'expro_logs','bid_logs','excel_imports','search_index',
    'solution_families','solution_types','opportunities_v2',
    'customer_ref_config','service_categories','company_account_managers',
    'company_bid_managers','won_records','lost_records','dropdown_configs',
    'system_settings'
  ]
  LOOP
    EXECUTE format('UPDATE %I SET company_id = 1 WHERE company_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', t);
    -- Transitional DEFAULT 1: every endpoint's INSERTs are being converted to
    -- set company_id explicitly from the authenticated user (see the endpoint
    -- conversion work tracked separately), but until that's complete for a
    -- given file, this default keeps existing INSERTs from breaking instead
    -- of silently defaulting new rows to the wrong tenant forever. Safe to
    -- drop once every INSERT across the codebase sets it explicitly.
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT 1', t);
  END LOOP;
END $$;
ALTER TABLE users ALTER COLUMN company_id SET DEFAULT 1;

-- Indexes for the tables hit by hot list/dashboard endpoints.
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_bids_company_id ON bids(company_id);
CREATE INDEX IF NOT EXISTS idx_vendors_company_id ON vendors(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_company_id ON opportunities(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_v2_company_id ON opportunities_v2(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company_id ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_company_id ON notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);

-- ── Telecom Costing Sheet ────────────────────────────────────────────────
-- One costing sheet per opportunities_v2 opportunity (1:1 — enforced via
-- UNIQUE on opp_id), carrying the same order_number as its parent
-- opportunity (copied from opportunities_v2.opp_number when the sheet is
-- lazily created on first access). Selling price / totals / VAT / grand
-- total are computed at read time in the API, never stored here.
CREATE TABLE IF NOT EXISTS opportunity_costing_sheets (
    costing_id      SERIAL PRIMARY KEY,
    opp_id          INT NOT NULL UNIQUE REFERENCES opportunities_v2(opp_id) ON DELETE CASCADE,
    company_id      INT NOT NULL REFERENCES companies(company_id),
    order_number    VARCHAR(30) NOT NULL,
    duration_months INT NOT NULL DEFAULT 12,
    vat_pct         NUMERIC(5,2) NOT NULL DEFAULT 15.00,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      INT REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS opportunity_costing_lines (
    line_id          SERIAL PRIMARY KEY,
    costing_id       INT NOT NULL REFERENCES opportunity_costing_sheets(costing_id) ON DELETE CASCADE,
    company_id       INT NOT NULL REFERENCES companies(company_id),
    sort_order       INT NOT NULL DEFAULT 0,
    service_name     VARCHAR(150) NOT NULL,
    bandwidth_mbps   NUMERIC(10,2),
    qty              INT NOT NULL DEFAULT 1,
    duration_months  INT,
    price_list_mrc   NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_list_nrc   NUMERIC(12,2) NOT NULL DEFAULT 0,
    expro_mrc        NUMERIC(12,2),
    expro_nrc        NUMERIC(12,2),
    discount_mrc_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
    discount_nrc_pct NUMERIC(5,4) NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_costing_lines_costing_id ON opportunity_costing_lines(costing_id);
CREATE INDEX IF NOT EXISTS idx_costing_sheets_company_id ON opportunity_costing_sheets(company_id);
