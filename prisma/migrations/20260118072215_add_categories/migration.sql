-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_organization_id_status_name_idx" ON "Category"("organization_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organization_id_name_key" ON "Category"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
