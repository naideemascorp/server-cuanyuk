CREATE TABLE IF NOT EXISTS ip_whitelist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ip              TEXT NOT NULL UNIQUE,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ip_whitelist_status ON ip_whitelist (status);

DROP TRIGGER IF EXISTS trg_ip_whitelist_updated ON ip_whitelist;
CREATE TRIGGER trg_ip_whitelist_updated BEFORE UPDATE ON ip_whitelist FOR EACH ROW EXECUTE FUNCTION set_updated_date();
