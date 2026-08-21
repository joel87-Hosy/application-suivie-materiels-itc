-- SaaS multi-tenant reference schema.
-- This file is not used by the current Firebase frontend directly.
-- Use it when migrating the platform to a SQL backend.

CREATE TABLE companies (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  email VARCHAR(180) NOT NULL,
  phone VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  plan_type VARCHAR(20) NOT NULL DEFAULT 'starter',
  max_users INT NOT NULL DEFAULT 10,
  max_stores INT NOT NULL DEFAULT 2,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT companies_status_chk CHECK (status IN ('active', 'suspended', 'expired')),
  CONSTRAINT companies_plan_chk CHECK (plan_type IN ('starter', 'business', 'enterprise'))
);

CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  company_id CHAR(36) NULL,
  role VARCHAR(30) NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_company_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT users_role_chk CHECK (
    role IN ('SUPER_ADMIN', 'SUPERVISEUR', 'MAGASINIER', 'COORDINATRICE', 'TECHNICIEN')
  ),
  CONSTRAINT users_super_admin_company_chk CHECK (
    (role = 'SUPER_ADMIN' AND company_id IS NULL)
    OR
    (role <> 'SUPER_ADMIN' AND company_id IS NOT NULL)
  )
);

-- Example changes for operational tables once they exist in SQL:
-- ALTER TABLE inventory_items ADD COLUMN company_id CHAR(36) NOT NULL;
-- ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_company_fk FOREIGN KEY (company_id) REFERENCES companies(id);
-- CREATE INDEX inventory_items_company_idx ON inventory_items(company_id);
--
-- ALTER TABLE audit_logs ADD COLUMN company_id CHAR(36) NOT NULL;
-- ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_company_fk FOREIGN KEY (company_id) REFERENCES companies(id);
-- CREATE INDEX audit_logs_company_idx ON audit_logs(company_id);
--
-- ALTER TABLE stock_transfers ADD COLUMN company_id CHAR(36) NOT NULL;
-- ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_company_fk FOREIGN KEY (company_id) REFERENCES companies(id);
-- CREATE INDEX stock_transfers_company_idx ON stock_transfers(company_id);

-- First super admin seed placeholder:
-- INSERT INTO users (id, company_id, role, full_name, email, password_hash, is_active)
-- VALUES ('00000000-0000-0000-0000-000000000001', NULL, 'SUPER_ADMIN', 'SUPER ADMIN', 'admin@system.local', '<bcrypt-hash>', TRUE);
