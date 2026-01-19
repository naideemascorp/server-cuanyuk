-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "picture_mime" TEXT;
ALTER TABLE "Merchant" ADD COLUMN     "picture_data" BYTEA;

-- AlterTable
ALTER TABLE "PaymentItem" ADD COLUMN     "qris_mime" TEXT;
ALTER TABLE "PaymentItem" ADD COLUMN     "qris_data" BYTEA;
