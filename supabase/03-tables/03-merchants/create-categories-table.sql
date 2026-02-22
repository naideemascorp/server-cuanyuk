CREATE TABLE IF NOT EXISTS categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_org_name ON categories (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_categories_org_status_name ON categories (organization_id, status, name);

DROP TRIGGER IF EXISTS trg_categories_updated ON categories;
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_date();
