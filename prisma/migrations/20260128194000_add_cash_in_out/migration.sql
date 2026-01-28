-- CreateEnum
CREATE TYPE "CashType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "cash_type" "CashType" NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "order_number" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "my_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "customer_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "merchant_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "merchant_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_organization_id_name_key" ON "Partner"("organization_id", "name");

-- CreateIndex
CREATE INDEX "Partner_organization_id_status_name_idx" ON "Partner"("organization_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_organization_id_order_number_key" ON "CashTransaction"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "CashTransaction_organization_id_status_transaction_date_idx" ON "CashTransaction"("organization_id", "status", "transaction_date");

-- CreateIndex
CREATE INDEX "CashTransaction_organization_id_cash_type_transaction_date_idx" ON "CashTransaction"("organization_id", "cash_type", "transaction_date");

-- CreateIndex
CREATE INDEX "CashTransaction_merchant_id_idx" ON "CashTransaction"("merchant_id");

-- CreateIndex
CREATE INDEX "CashTransaction_partner_id_idx" ON "CashTransaction"("partner_id");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

