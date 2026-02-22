CREATE TABLE IF NOT EXISTS payment_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind            payment_kind NOT NULL,
  payment_url     TEXT,
  qris_path       TEXT,
  qris_mime       TEXT,
  qris_data       BYTEA,
  total_amount    INT NOT NULL DEFAULT 0,
  active_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  inactivated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_items_merchant_status_expires ON payment_items (merchant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_items_org_status_created ON payment_items (organization_id, status, created_date);

DROP TRIGGER IF EXISTS trg_payment_items_updated ON payment_items;
CREATE TRIGGER trg_payment_items_updated BEFORE UPDATE ON payment_items FOR EACH ROW EXECUTE FUNCTION set_updated_date();
