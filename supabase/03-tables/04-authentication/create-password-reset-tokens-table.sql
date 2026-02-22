CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        record_status NOT NULL DEFAULT 'ACTIVE',
  created_by    TEXT,
  updated_by    TEXT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_tokens_user_status_expires ON password_reset_tokens (user_id, status, expires_at, created_date);

DROP TRIGGER IF EXISTS trg_password_reset_tokens_updated ON password_reset_tokens;
CREATE TRIGGER trg_password_reset_tokens_updated BEFORE UPDATE ON password_reset_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_date();
