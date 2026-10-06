-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('EVOLUTION', 'WUZAPI', 'CLOUD_API');

-- CreateEnum
CREATE TYPE "NumberStatus" AS ENUM ('ACTIVE', 'WARMING', 'BANNED', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ClientRole" AS ENUM ('ADMIN', 'CLIENT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MEMBER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "InstanceConnState" AS ENUM ('DISCONNECTED', 'QR_PENDING', 'CONNECTED', 'BANNED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'BUTTONS', 'LOCATION', 'CONTACT', 'POLL', 'LIST');

-- CreateEnum
CREATE TYPE "RotationReason" AS ENUM ('BAN', 'LIMIT_REACHED', 'MANUAL', 'SCHEDULED', 'ERROR_RATE');

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "slug" TEXT,
    "phone" TEXT,
    "label" TEXT,
    "provider" "Provider" NOT NULL,
    "instanceId" TEXT,
    "status" "NumberStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "connectionState" "InstanceConnState" NOT NULL DEFAULT 'DISCONNECTED',
    "qrCode" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "apiClientId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentTotal" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bannedAt" TIMESTAMP(3),
    "banReason" TEXT,
    "bannedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceNumber" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerInstanceId" TEXT,
    "phone" TEXT,
    "label" TEXT,
    "status" "NumberStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "connectionState" "InstanceConnState" NOT NULL DEFAULT 'DISCONNECTED',
    "qrCode" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentTotal" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bannedAt" TIMESTAMP(3),
    "banReason" TEXT,
    "bannedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "apiClientId" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "caption" TEXT,
    "buttons" JSONB,
    "location" JSONB,
    "contact" JSONB,
    "poll" JSONB,
    "list" JSONB,
    "providerId" TEXT,
    "instanceId" TEXT,
    "numberId" TEXT,
    "provider" "Provider",
    "providerAttempt" INTEGER NOT NULL DEFAULT 1,
    "campaignId" TEXT,
    "createdByUserId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "apiClientId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "numberId" TEXT,
    "from" TEXT NOT NULL,
    "fromLid" TEXT,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "buttonText" TEXT,
    "listRowId" TEXT,
    "listTitle" TEXT,
    "providerMessageId" TEXT,
    "mediaType" TEXT,
    "mimetype" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "apiClientId" TEXT NOT NULL,
    "instanceId" TEXT,
    "createdByUserId" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "instanceId" TEXT,
    "attempt" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMsg" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberRotation" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "numberId" TEXT,
    "reason" "RotationReason" NOT NULL,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiKeyHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role" "ClientRole" NOT NULL DEFAULT 'CLIENT',
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rateLimit" INTEGER NOT NULL DEFAULT 100,
    "maxPerRecipientPerHour" INTEGER NOT NULL DEFAULT 10,
    "maxInstances" INTEGER NOT NULL DEFAULT 1,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "apiClientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT,
    "apiClientId" TEXT,
    "lastCalledAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instance_slug_key" ON "Instance"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_token_key" ON "Instance"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_tokenHash_key" ON "Instance"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_webhookSecret_key" ON "Instance"("webhookSecret");

-- CreateIndex
CREATE INDEX "Instance_status_priority_idx" ON "Instance"("status", "priority");

-- CreateIndex
CREATE INDEX "Instance_provider_idx" ON "Instance"("provider");

-- CreateIndex
CREATE INDEX "Instance_apiClientId_status_idx" ON "Instance"("apiClientId", "status");

-- CreateIndex
CREATE INDEX "Instance_ownerUserId_idx" ON "Instance"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_apiClientId_phone_key" ON "Instance"("apiClientId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_apiClientId_name_key" ON "Instance"("apiClientId", "name");

-- CreateIndex
CREATE INDEX "InstanceNumber_instanceId_idx" ON "InstanceNumber"("instanceId");

-- CreateIndex
CREATE INDEX "InstanceNumber_status_priority_idx" ON "InstanceNumber"("status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceNumber_instanceId_phone_key" ON "InstanceNumber"("instanceId", "phone");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_toPhone_idx" ON "Message"("toPhone");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "Message_scheduledAt_idx" ON "Message"("scheduledAt");

-- CreateIndex
CREATE INDEX "Message_apiClientId_createdAt_idx" ON "Message"("apiClientId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_instanceId_idx" ON "Message"("instanceId");

-- CreateIndex
CREATE INDEX "Message_numberId_idx" ON "Message"("numberId");

-- CreateIndex
CREATE INDEX "Message_campaignId_idx" ON "Message"("campaignId");

-- CreateIndex
CREATE INDEX "Message_createdByUserId_idx" ON "Message"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_apiClientId_externalId_key" ON "Message"("apiClientId", "externalId");

-- CreateIndex
CREATE INDEX "InboundMessage_apiClientId_createdAt_idx" ON "InboundMessage"("apiClientId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_instanceId_idx" ON "InboundMessage"("instanceId");

-- CreateIndex
CREATE INDEX "Campaign_apiClientId_createdAt_idx" ON "Campaign"("apiClientId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageAttempt_messageId_idx" ON "MessageAttempt"("messageId");

-- CreateIndex
CREATE INDEX "NumberRotation_instanceId_idx" ON "NumberRotation"("instanceId");

-- CreateIndex
CREATE INDEX "NumberRotation_numberId_idx" ON "NumberRotation"("numberId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_apiKey_key" ON "ApiClient"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_apiKeyHash_key" ON "ApiClient"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE INDEX "User_apiClientId_idx" ON "User"("apiClientId");

-- CreateIndex
CREATE INDEX "Webhook_apiClientId_idx" ON "Webhook"("apiClientId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceNumber" ADD CONSTRAINT "InstanceNumber_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "InstanceNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberRotation" ADD CONSTRAINT "NumberRotation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberRotation" ADD CONSTRAINT "NumberRotation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "InstanceNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

