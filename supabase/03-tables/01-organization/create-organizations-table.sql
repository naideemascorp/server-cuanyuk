CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        record_status NOT NULL DEFAULT 'ACTIVE',
  created_by    TEXT,
  updated_by    TEXT,
  display_name  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organizations_status_created ON organizations (status, created_date);

DROP TRIGGER IF EXISTS trg_organizations_updated ON organizations;
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_date();
