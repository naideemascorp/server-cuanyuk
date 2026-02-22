CREATE TABLE IF NOT EXISTS cash_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          record_status NOT NULL DEFAULT 'PENDING',
  created_by      TEXT,
  updated_by      TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cash_type       cash_type NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  order_number    TEXT NOT NULL,
  total_amount    INT NOT NULL DEFAULT 0,
  customer_fee_bps INT NOT NULL DEFAULT 0,
  merchant_fee_bps INT NOT NULL DEFAULT 0,
  remarks         TEXT,
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  partner_id      UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_tx_org_status_date ON cash_transactions (organization_id, status, transaction_date);
CREATE INDEX IF NOT EXISTS idx_cash_tx_org_type_date ON cash_transactions (organization_id, cash_type, transaction_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_tx_org_order ON cash_transactions (organization_id, order_number);
CREATE INDEX IF NOT EXISTS idx_cash_tx_merchant ON cash_transactions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_cash_tx_partner ON cash_transactions (partner_id);

DROP TRIGGER IF EXISTS trg_cash_transactions_updated ON cash_transactions;
CREATE TRIGGER trg_cash_transactions_updated BEFORE UPDATE ON cash_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_date();
