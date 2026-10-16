-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('ORG_ADMIN', 'FACILITY_MANAGER', 'ATTENDANT', 'FINANCE', 'DEVICE_TECHNICIAN', 'DRIVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FacilityAccessRole" AS ENUM ('FACILITY_MANAGER', 'ATTENDANT', 'FINANCE', 'DEVICE_TECHNICIAN', 'DRIVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('ACTIVE', 'EXITED', 'REVIEW');

-- CreateEnum
CREATE TYPE "GateDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EventValidation" AS ENUM ('VERIFIED', 'REVIEW_REQUIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BayEvidenceSource" AS ENUM ('DEVICE_REPORT', 'BAY_SENSOR', 'OVERHEAD_CAMERA', 'AISLE_CAMERA', 'INBOUND_ANPR', 'OUTBOUND_ANPR', 'ATTENDANT', 'RESERVATION_CONTEXT', 'SIMULATION');

-- CreateEnum
CREATE TYPE "EvidenceResult" AS ENUM ('OCCUPIED', 'VACANT', 'UNKNOWN', 'CONFLICTING');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PLATFORM_ADMIN';

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "allowPublicReservations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityAccess" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "role" "FacilityAccessRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityVisit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vehicleReference" TEXT,
    "inboundEventId" TEXT NOT NULL,
    "outboundEventId" TEXT,
    "inboundAt" TIMESTAMP(3) NOT NULL,
    "exitedAt" TIMESTAMP(3),
    "status" "PresenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "provenance" TEXT NOT NULL,
    "currentBayId" TEXT,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "deviceId" TEXT,
    "sourceEventId" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "direction" "GateDirection" NOT NULL,
    "validation" "EventValidation" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "vehicleReference" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provenance" TEXT NOT NULL,
    "payloadDigest" TEXT,
    "visitId" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BayObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "slotId" TEXT,
    "visitId" TEXT,
    "deviceId" TEXT,
    "gateEventId" TEXT,
    "source" "BayEvidenceSource" NOT NULL,
    "sourceReference" TEXT,
    "deduplicationKey" TEXT NOT NULL,
    "result" "EvidenceResult" NOT NULL,
    "vehicleReference" TEXT,
    "confidence" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshnessSeconds" INTEGER,
    "details" JSONB,

    CONSTRAINT "BayObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "slotId" TEXT,
    "visitId" TEXT,
    "gateEventId" TEXT,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscrepancyEvidence" (
    "discrepancyId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscrepancyEvidence_pkey" PRIMARY KEY ("discrepancyId","observationId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "facilityId" TEXT,
    "actorUserId" TEXT,
    "actorSystem" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "reason" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMembership_organizationId_role_status_idx" ON "OrganizationMembership"("organizationId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "FacilityAccess_facilityId_role_idx" ON "FacilityAccess"("facilityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityAccess_membershipId_facilityId_key" ON "FacilityAccess"("membershipId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityVisit_inboundEventId_key" ON "FacilityVisit"("inboundEventId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityVisit_outboundEventId_key" ON "FacilityVisit"("outboundEventId");

-- CreateIndex
CREATE INDEX "FacilityVisit_facilityId_status_inboundAt_idx" ON "FacilityVisit"("facilityId", "status", "inboundAt");

-- CreateIndex
CREATE INDEX "FacilityVisit_organizationId_status_idx" ON "FacilityVisit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FacilityVisit_vehicleReference_facilityId_inboundAt_idx" ON "FacilityVisit"("vehicleReference", "facilityId", "inboundAt");

-- CreateIndex
CREATE INDEX "FacilityVisit_currentBayId_idx" ON "FacilityVisit"("currentBayId");

-- CreateIndex
CREATE UNIQUE INDEX "GateEvent_deduplicationKey_key" ON "GateEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "GateEvent_facilityId_eventAt_direction_idx" ON "GateEvent"("facilityId", "eventAt", "direction");

-- CreateIndex
CREATE INDEX "GateEvent_organizationId_eventAt_idx" ON "GateEvent"("organizationId", "eventAt");

-- CreateIndex
CREATE INDEX "GateEvent_visitId_idx" ON "GateEvent"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "GateEvent_facilityId_sourceEventId_key" ON "GateEvent"("facilityId", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "BayObservation_deduplicationKey_key" ON "BayObservation"("deduplicationKey");

-- CreateIndex
CREATE INDEX "BayObservation_facilityId_slotId_observedAt_idx" ON "BayObservation"("facilityId", "slotId", "observedAt");

-- CreateIndex
CREATE INDEX "BayObservation_organizationId_receivedAt_idx" ON "BayObservation"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "BayObservation_visitId_observedAt_idx" ON "BayObservation"("visitId", "observedAt");

-- CreateIndex
CREATE INDEX "BayObservation_source_observedAt_idx" ON "BayObservation"("source", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Discrepancy_gateEventId_key" ON "Discrepancy"("gateEventId");

-- CreateIndex
CREATE INDEX "Discrepancy_facilityId_status_openedAt_idx" ON "Discrepancy"("facilityId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "Discrepancy_organizationId_status_idx" ON "Discrepancy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DiscrepancyEvidence_observationId_idx" ON "DiscrepancyEvidence"("observationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_facilityId_occurredAt_idx" ON "AuditEvent"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_occurredAt_idx" ON "AuditEvent"("resourceType", "resourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "Facility_organizationId_idx" ON "Facility"("organizationId");

-- CreateIndex
CREATE INDEX "Reservation_slotId_status_startTime_endTime_idx" ON "Reservation"("slotId", "status", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "Reservation_userId_createdAt_idx" ON "Reservation"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAccess" ADD CONSTRAINT "FacilityAccess_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAccess" ADD CONSTRAINT "FacilityAccess_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_currentBayId_fkey" FOREIGN KEY ("currentBayId") REFERENCES "ParkingSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_inboundEventId_fkey" FOREIGN KEY ("inboundEventId") REFERENCES "GateEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_outboundEventId_fkey" FOREIGN KEY ("outboundEventId") REFERENCES "GateEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FacilityVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ParkingSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FacilityVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BayObservation" ADD CONSTRAINT "BayObservation_gateEventId_fkey" FOREIGN KEY ("gateEventId") REFERENCES "GateEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ParkingSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FacilityVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_gateEventId_fkey" FOREIGN KEY ("gateEventId") REFERENCES "GateEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyEvidence" ADD CONSTRAINT "DiscrepancyEvidence_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "Discrepancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyEvidence" ADD CONSTRAINT "DiscrepancyEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BayObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open visit per pseudonymous vehicle at a facility. A bay-vacancy event
-- never sets exitedAt; a verified outbound event reference is required.
CREATE UNIQUE INDEX "FacilityVisit_one_open_visit_per_vehicle"
ON "FacilityVisit" ("facilityId", "vehicleReference")
WHERE "exitedAt" IS NULL AND "vehicleReference" IS NOT NULL;

ALTER TABLE "BayObservation"
ADD CONSTRAINT "BayObservation_confidence_range_check"
CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "FacilityVisit"
ADD CONSTRAINT "FacilityVisit_exit_requires_verified_event_reference"
CHECK (("status" = 'EXITED' AND "exitedAt" IS NOT NULL AND "outboundEventId" IS NOT NULL) OR ("status" <> 'EXITED' AND "exitedAt" IS NULL));

ALTER TABLE "Discrepancy"
ADD CONSTRAINT "Discrepancy_resolution_requires_actor_and_reason"
CHECK (("status" <> 'RESOLVED') OR ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND COALESCE(length(trim("resolution")), 0) >= 10));

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_requires_actor"
CHECK ("actorUserId" IS NOT NULL OR "actorSystem" IS NOT NULL);

CREATE FUNCTION "validate_visit_exit_event"() RETURNS trigger AS $$
DECLARE
  inbound_direction "GateDirection";
  inbound_validation "EventValidation";
  inbound_facility TEXT;
  inbound_reference TEXT;
  inbound_time TIMESTAMP(3);
  exit_direction "GateDirection";
  exit_validation "EventValidation";
  exit_facility TEXT;
  exit_reference TEXT;
  exit_time TIMESTAMP(3);
BEGIN
  SELECT "direction", "validation", "facilityId", "vehicleReference", "eventAt"
  INTO inbound_direction, inbound_validation, inbound_facility, inbound_reference, inbound_time
  FROM "GateEvent" WHERE "id" = NEW."inboundEventId";
  IF inbound_direction IS DISTINCT FROM 'INBOUND'::"GateDirection"
    OR inbound_validation IS DISTINCT FROM 'VERIFIED'::"EventValidation"
    OR inbound_facility IS DISTINCT FROM NEW."facilityId"
    OR inbound_reference IS DISTINCT FROM NEW."vehicleReference"
    OR inbound_time IS DISTINCT FROM NEW."inboundAt" THEN
    RAISE EXCEPTION 'Visit entry requires a matching verified inbound gate event';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'EXITED'
    AND (NEW."status", NEW."exitedAt", NEW."outboundEventId")
      IS DISTINCT FROM (OLD."status", OLD."exitedAt", OLD."outboundEventId") THEN
    RAISE EXCEPTION 'An exited visit cannot be closed again or relinked';
  END IF;

  IF NEW."status" = 'EXITED' THEN
    SELECT "direction", "validation", "facilityId", "vehicleReference", "eventAt"
    INTO exit_direction, exit_validation, exit_facility, exit_reference, exit_time
    FROM "GateEvent" WHERE "id" = NEW."outboundEventId";
    IF exit_direction IS DISTINCT FROM 'OUTBOUND'::"GateDirection"
      OR exit_validation IS DISTINCT FROM 'VERIFIED'::"EventValidation"
      OR exit_facility IS DISTINCT FROM NEW."facilityId"
      OR exit_reference IS DISTINCT FROM NEW."vehicleReference"
      OR exit_time IS DISTINCT FROM NEW."exitedAt"
      OR exit_time < NEW."inboundAt" THEN
      RAISE EXCEPTION 'Visit exit requires a matching verified outbound gate event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FacilityVisit_verified_exit_check" BEFORE INSERT OR UPDATE ON "FacilityVisit"
FOR EACH ROW EXECUTE FUNCTION "validate_visit_exit_event"();

CREATE FUNCTION "validate_facility_access_tenant"() RETURNS trigger AS $$
DECLARE
  membership_org TEXT;
  facility_org TEXT;
BEGIN
  SELECT "organizationId" INTO membership_org FROM "OrganizationMembership" WHERE "id" = NEW."membershipId";
  SELECT "organizationId" INTO facility_org FROM "Facility" WHERE "id" = NEW."facilityId";
  IF membership_org IS NULL OR facility_org IS NULL OR membership_org <> facility_org THEN
    RAISE EXCEPTION 'Facility access must match the membership organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FacilityAccess_tenant_check"
BEFORE INSERT OR UPDATE ON "FacilityAccess"
FOR EACH ROW EXECUTE FUNCTION "validate_facility_access_tenant"();

CREATE FUNCTION "validate_resource_organization"() RETURNS trigger AS $$
DECLARE facility_org TEXT;
BEGIN
  IF NEW."facilityId" IS NOT NULL THEN
    SELECT "organizationId" INTO facility_org FROM "Facility" WHERE "id" = NEW."facilityId";
    IF facility_org IS NULL OR NEW."organizationId" IS DISTINCT FROM facility_org THEN
      RAISE EXCEPTION 'Resource organization must match its assigned facility';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FacilityVisit_tenant_check" BEFORE INSERT OR UPDATE ON "FacilityVisit"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_organization"();
CREATE TRIGGER "GateEvent_tenant_check" BEFORE INSERT OR UPDATE ON "GateEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_organization"();
CREATE TRIGGER "BayObservation_tenant_check" BEFORE INSERT OR UPDATE ON "BayObservation"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_organization"();
CREATE TRIGGER "Discrepancy_tenant_check" BEFORE INSERT OR UPDATE ON "Discrepancy"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_organization"();
CREATE TRIGGER "AuditEvent_tenant_check" BEFORE INSERT OR UPDATE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_organization"();

CREATE FUNCTION "validate_observation_slot_facility"() RETURNS trigger AS $$
DECLARE slot_facility TEXT;
BEGIN
  IF NEW."slotId" IS NOT NULL THEN
    SELECT z."facilityId" INTO slot_facility
    FROM "ParkingSlot" s JOIN "Zone" z ON z."id" = s."zoneId"
    WHERE s."id" = NEW."slotId";
    IF slot_facility IS DISTINCT FROM NEW."facilityId" THEN
      RAISE EXCEPTION 'Observation bay must belong to its facility';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BayObservation_slot_facility_check" BEFORE INSERT OR UPDATE ON "BayObservation"
FOR EACH ROW EXECUTE FUNCTION "validate_observation_slot_facility"();
CREATE TRIGGER "Discrepancy_slot_facility_check" BEFORE INSERT OR UPDATE ON "Discrepancy"
FOR EACH ROW EXECUTE FUNCTION "validate_observation_slot_facility"();

CREATE FUNCTION "validate_visit_facility_links"() RETURNS trigger AS $$
DECLARE linked_facility TEXT;
BEGIN
  IF NEW."currentBayId" IS NOT NULL THEN
    SELECT z."facilityId" INTO linked_facility
    FROM "ParkingSlot" s JOIN "Zone" z ON z."id" = s."zoneId"
    WHERE s."id" = NEW."currentBayId";
    IF linked_facility IS DISTINCT FROM NEW."facilityId" THEN
      RAISE EXCEPTION 'Visit bay must belong to its facility';
    END IF;
  END IF;
  IF NEW."reservationId" IS NOT NULL THEN
    SELECT z."facilityId" INTO linked_facility
    FROM "Reservation" r JOIN "ParkingSlot" s ON s."id" = r."slotId"
    JOIN "Zone" z ON z."id" = s."zoneId"
    WHERE r."id" = NEW."reservationId";
    IF linked_facility IS DISTINCT FROM NEW."facilityId" THEN
      RAISE EXCEPTION 'Visit reservation must belong to its facility';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FacilityVisit_facility_links_check" BEFORE INSERT OR UPDATE ON "FacilityVisit"
FOR EACH ROW EXECUTE FUNCTION "validate_visit_facility_links"();

CREATE FUNCTION "prevent_facility_reassignment"() RETURNS trigger AS $$
BEGIN
  IF OLD."organizationId" IS NOT NULL AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'Facility reassignment requires a reviewed transfer workflow';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Facility_assignment_is_one_way" BEFORE UPDATE OF "organizationId" ON "Facility"
FOR EACH ROW EXECUTE FUNCTION "prevent_facility_reassignment"();

CREATE FUNCTION "reject_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();
