CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        record_status NOT NULL DEFAULT 'ACTIVE',
  created_by    TEXT,
  updated_by    TEXT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jwt_id        TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_status_expires ON sessions (user_id, status, expires_at);

DROP TRIGGER IF EXISTS trg_sessions_updated ON sessions;
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_date();
