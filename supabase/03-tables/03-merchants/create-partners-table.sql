CREATE TABLE IF NOT EXISTS partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_org_name ON partners (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_partners_org_status_name ON partners (organization_id, status, name);

DROP TRIGGER IF EXISTS trg_partners_updated ON partners;
CREATE TRIGGER trg_partners_updated BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION set_updated_date();
