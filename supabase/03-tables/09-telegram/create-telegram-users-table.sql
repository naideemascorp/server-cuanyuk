CREATE TABLE IF NOT EXISTS telegram_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        record_status NOT NULL DEFAULT 'ACTIVE',
  created_by    TEXT,
  updated_by    TEXT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_id   BIGINT NOT NULL UNIQUE,
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_user_status ON telegram_users (user_id, status);

DROP TRIGGER IF EXISTS trg_telegram_users_updated ON telegram_users;
CREATE TRIGGER trg_telegram_users_updated BEFORE UPDATE ON telegram_users FOR EACH ROW EXECUTE FUNCTION set_updated_date();
