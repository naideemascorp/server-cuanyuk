CREATE TABLE IF NOT EXISTS merchants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  picture_path    TEXT,
  picture_mime    TEXT,
  picture_data    BYTEA,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_org_name ON merchants (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_merchants_org_category_status ON merchants (organization_id, category, status);

DROP TRIGGER IF EXISTS trg_merchants_updated ON merchants;
CREATE TRIGGER trg_merchants_updated BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION set_updated_date();
