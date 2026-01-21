-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "recipient_organization_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "recipient_roles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[];

