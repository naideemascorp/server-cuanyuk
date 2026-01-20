-- CreateTable
CREATE TABLE "DeviceWhitelist" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT,
    "device_id" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "DeviceWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceWhitelist_device_id_key" ON "DeviceWhitelist"("device_id");

-- CreateIndex
CREATE INDEX "DeviceWhitelist_status_idx" ON "DeviceWhitelist"("status");

-- AddForeignKey
ALTER TABLE "DeviceWhitelist" ADD CONSTRAINT "DeviceWhitelist_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

