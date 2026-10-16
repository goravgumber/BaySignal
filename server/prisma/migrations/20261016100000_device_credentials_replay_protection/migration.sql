ALTER TABLE "Device"
ADD COLUMN "ingestionEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceRequest" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceCredential_deviceId_revokedAt_idx"
ON "DeviceCredential"("deviceId", "revokedAt");

CREATE UNIQUE INDEX "DeviceRequest_deviceId_requestId_key"
ON "DeviceRequest"("deviceId", "requestId");

CREATE INDEX "DeviceRequest_expiresAt_idx" ON "DeviceRequest"("expiresAt");

ALTER TABLE "DeviceCredential"
ADD CONSTRAINT "DeviceCredential_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceRequest"
ADD CONSTRAINT "DeviceRequest_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
