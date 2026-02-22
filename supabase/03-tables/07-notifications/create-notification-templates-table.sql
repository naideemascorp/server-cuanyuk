CREATE TABLE IF NOT EXISTS notification_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        record_status NOT NULL DEFAULT 'ACTIVE',
  created_by    TEXT,
  updated_by    TEXT,
  key           notification_template_key NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_templates_status_updated ON notification_templates (status, updated_date);

DROP TRIGGER IF EXISTS trg_notification_templates_updated ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated BEFORE UPDATE ON notification_templates FOR EACH ROW EXECUTE FUNCTION set_updated_date();
