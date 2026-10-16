import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const baselineSql = readFileSync(new URL('../prisma/migrations/20261015100000_baseline/migration.sql', import.meta.url), 'utf8')
const additiveSql = readFileSync(new URL('../prisma/migrations/20261015101000_add_tenant_presence_evidence_audit/migration.sql', import.meta.url), 'utf8')
const deviceSql = readFileSync(new URL('../prisma/migrations/20261016100000_device_credentials_replay_protection/migration.sql', import.meta.url), 'utf8')

test('existing-database baseline has an explicit adopt-only warning', () => {
  assert.match(baselineSql, /Clean database bootstrap only/)
  assert.match(baselineSql, /migrate resolve --applied 20261015100000_baseline/)
  assert.match(baselineSql, /CREATE TABLE "User"/)
})

test('forward migration is additive and preserves legacy rows as unassigned', () => {
  assert.doesNotMatch(additiveSql, /DROP\s+(TABLE|COLUMN|TYPE)/i)
  assert.doesNotMatch(additiveSql, /CREATE TABLE\s+"(User|Facility|Zone|ParkingSlot|Reservation|Device|Alert)"/)
  assert.match(additiveSql, /"allowPublicReservations"\s+BOOLEAN NOT NULL DEFAULT false/)
  assert.match(additiveSql, /"organizationId"\s+TEXT/)
})

test('forward migration enforces open-visit uniqueness and append-only audit rows', () => {
  assert.match(additiveSql, /FacilityVisit_one_open_visit_per_vehicle/)
  assert.match(additiveSql, /WHERE "exitedAt" IS NULL AND "vehicleReference" IS NOT NULL/)
  assert.match(additiveSql, /CREATE TRIGGER "AuditEvent_append_only"\s+BEFORE UPDATE OR DELETE/)
  assert.match(additiveSql, /FacilityVisit_verified_exit_check/)
  assert.match(additiveSql, /Visit entry requires a matching verified inbound gate event/)
  assert.match(additiveSql, /Visit exit requires a matching verified outbound gate event/)
  assert.match(additiveSql, /An exited visit cannot be closed again or relinked/)
})

test('existing-database workflow compares schema before resolving the baseline', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/db-setup.yml', import.meta.url), 'utf8')
  assert.match(workflow, /migrate diff --from-url .*baseline-schema\.prisma --exit-code/)
  assert.ok(workflow.indexOf('Verify existing database exactly matches') < workflow.indexOf('Adopt the reviewed baseline'))
})

test('device credential migration stores public keys and enforces per-device replay uniqueness', () => {
  assert.match(deviceSql, /CREATE TABLE "DeviceCredential"/)
  assert.match(deviceSql, /"publicKey" TEXT NOT NULL/)
  assert.doesNotMatch(deviceSql, /privateKey|secretHash|DEVICE_API_KEY/i)
  assert.match(deviceSql, /CREATE UNIQUE INDEX "DeviceRequest_deviceId_requestId_key"/)
  assert.match(deviceSql, /"ingestionEnabled" BOOLEAN NOT NULL DEFAULT true/)
})

test('PostgreSQL harness is restricted to the named loopback test databases', () => {
  const migrationHarness = readFileSync(new URL('../scripts/test-postgres-migrations.js', import.meta.url), 'utf8')
  const integrationRunner = readFileSync(new URL('../scripts/run-postgres-integration.js', import.meta.url), 'utf8')
  assert.match(migrationHarness, /new Set\(\['localhost', '127\.0\.0\.1', '\[::1\]'\]\)/)
  assert.match(migrationHarness, /parsedAdmin\.port !== '5432' \|\| parsedAdmin\.search \|\| parsedAdmin\.hash/)
  assert.match(migrationHarness, /BAYSIGNAL_TEST_DB_CONFIRMATION !== 'EPHEMERAL-POSTGRES'/)
  assert.match(integrationRunner, /target\.pathname !== '\/baysignal_test_integration'/)
  assert.match(integrationRunner, /target\.port !== '5432' \|\| target\.search \|\| target\.hash/)
  assert.match(integrationRunner, /BAYSIGNAL_TEST_DB_CONFIRMATION !== 'EPHEMERAL-POSTGRES'/)
  const integrationSuite = readFileSync(new URL('./postgres.integration.test.js', import.meta.url), 'utf8')
  assert.match(integrationSuite, /integration suite requires explicit disposable database confirmation/)
  assert.match(integrationSuite, /integration tests refuse non-loopback database hosts/)
})
