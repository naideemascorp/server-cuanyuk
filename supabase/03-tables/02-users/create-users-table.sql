CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                record_status NOT NULL DEFAULT 'PENDING',
  created_by            TEXT,
  updated_by            TEXT,
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  username              TEXT NOT NULL,
  email                 TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  email_verified_at     TIMESTAMPTZ,
  role                  user_role NOT NULL DEFAULT 'USER',
  notifications_read_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_username ON users (organization_id, username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users (organization_id, email);
CREATE INDEX IF NOT EXISTS idx_users_status_verified ON users (status, email_verified_at);

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_date();
