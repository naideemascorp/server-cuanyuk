-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('LINK', 'QRIS');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "user_id" TEXT NOT NULL,
    "jwt_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IPWhitelist" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT,
    "ip" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "IPWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentItem" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "organization_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "payment_url" TEXT,
    "qris_path" TEXT,
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "inactivated_at" TIMESTAMP(3),

    CONSTRAINT "PaymentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUser" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "user_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "TelegramUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_status_created_date_idx" ON "Organization"("status", "created_date");

-- CreateIndex
CREATE INDEX "User_status_email_verified_at_idx" ON "User"("status", "email_verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "User_organization_id_username_key" ON "User"("organization_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "User_organization_id_email_key" ON "User"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_jwt_id_key" ON "Session"("jwt_id");

-- CreateIndex
CREATE INDEX "Session_user_id_status_expires_at_idx" ON "Session"("user_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_token_key" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_user_id_status_expires_at_idx" ON "EmailVerificationToken"("user_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "IPWhitelist_ip_key" ON "IPWhitelist"("ip");

-- CreateIndex
CREATE INDEX "IPWhitelist_status_idx" ON "IPWhitelist"("status");

-- CreateIndex
CREATE INDEX "Merchant_organization_id_category_status_idx" ON "Merchant"("organization_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_organization_id_name_key" ON "Merchant"("organization_id", "name");

-- CreateIndex
CREATE INDEX "PaymentItem_merchant_id_status_expires_at_idx" ON "PaymentItem"("merchant_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "PaymentItem_organization_id_status_created_date_idx" ON "PaymentItem"("organization_id", "status", "created_date");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUser_telegram_id_key" ON "TelegramUser"("telegram_id");

-- CreateIndex
CREATE INDEX "TelegramUser_user_id_status_idx" ON "TelegramUser"("user_id", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IPWhitelist" ADD CONSTRAINT "IPWhitelist_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentItem" ADD CONSTRAINT "PaymentItem_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentItem" ADD CONSTRAINT "PaymentItem_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUser" ADD CONSTRAINT "TelegramUser_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

