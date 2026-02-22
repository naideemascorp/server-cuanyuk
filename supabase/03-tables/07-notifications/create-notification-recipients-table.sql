CREATE TABLE IF NOT EXISTS notification_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_recipients_unique ON notification_recipients (notification_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipients_user ON notification_recipients (user_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipients_notif ON notification_recipients (notification_id);

DROP TRIGGER IF EXISTS trg_notification_recipients_updated ON notification_recipients;
CREATE TRIGGER trg_notification_recipients_updated BEFORE UPDATE ON notification_recipients FOR EACH ROW EXECUTE FUNCTION set_updated_date();
