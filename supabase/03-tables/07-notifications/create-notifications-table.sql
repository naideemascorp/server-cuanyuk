CREATE TABLE IF NOT EXISTS notifications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                    record_status NOT NULL DEFAULT 'ACTIVE',
  created_by                TEXT,
  updated_by                TEXT,
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  importance                notification_importance NOT NULL DEFAULT 'LOW',
  title                     TEXT NOT NULL,
  description               TEXT NOT NULL,
  publish_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_welcome                BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_organization_ids TEXT[] NOT NULL DEFAULT '{}',
  recipient_roles           user_role[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_status_publish ON notifications (organization_id, status, publish_at);

DROP TRIGGER IF EXISTS trg_notifications_updated ON notifications;
CREATE TRIGGER trg_notifications_updated BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_date();
