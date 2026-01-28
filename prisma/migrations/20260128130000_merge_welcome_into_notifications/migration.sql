ALTER TABLE "Notification" ADD COLUMN     "is_welcome" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Notification_welcome_org_unique"
ON "Notification" ("organization_id")
WHERE ("is_welcome" = true);
