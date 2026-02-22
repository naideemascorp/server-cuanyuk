CREATE TABLE IF NOT EXISTS email_verification_tokens (
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

CREATE INDEX IF NOT EXISTS idx_email_tokens_user_status_expires ON email_verification_tokens (user_id, status, expires_at);

DROP TRIGGER IF EXISTS trg_email_verification_tokens_updated ON email_verification_tokens;
CREATE TRIGGER trg_email_verification_tokens_updated BEFORE UPDATE ON email_verification_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_date();
