CREATE TABLE IF NOT EXISTS device_whitelist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  device_id       TEXT NOT NULL UNIQUE,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_whitelist_status ON device_whitelist (status);

DROP TRIGGER IF EXISTS trg_device_whitelist_updated ON device_whitelist;
CREATE TRIGGER trg_device_whitelist_updated BEFORE UPDATE ON device_whitelist FOR EACH ROW EXECUTE FUNCTION set_updated_date();
