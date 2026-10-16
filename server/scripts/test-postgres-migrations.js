import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
if (!adminUrl) throw new Error('Set TEST_DATABASE_ADMIN_URL to an isolated local PostgreSQL admin URL.')
if (process.env.BAYSIGNAL_TEST_DB_CONFIRMATION !== 'EPHEMERAL-POSTGRES') {
  throw new Error('Set BAYSIGNAL_TEST_DB_CONFIRMATION=EPHEMERAL-POSTGRES only for a disposable PostgreSQL service.')
}

const parsedAdmin = new URL(adminUrl)
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
if (!allowedHosts.has(parsedAdmin.hostname) || parsedAdmin.port !== '5432' || parsedAdmin.search || parsedAdmin.hash || !['postgres', 'template1'].includes(parsedAdmin.pathname.slice(1))) {
  throw new Error('Refusing database integration tests unless the admin URL targets a loopback address on port 5432 and the postgres/template1 database, without URL overrides.')
}

const admin = new Client({ connectionString: adminUrl })
const names = ['baysignal_test_fresh', 'baysignal_test_adoption', 'baysignal_test_drift', 'baysignal_test_integration']
const migrationSql = await readFile(new URL('../prisma/migrations/20261015100000_baseline/migration.sql', import.meta.url), 'utf8')
const migrationDirectories = await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })
const expectedMigrationChain = migrationDirectories
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .join(',')
const prismaCli = new URL('../node_modules/prisma/build/index.js', import.meta.url)
let integrationReady = false

function databaseUrl(name) {
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function prisma(args, url, expected = 0) {
  const result = spawnSync(process.execPath, [prismaCli.pathname, ...args], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8'
  })
  if (result.status !== expected) {
    throw new Error(`Prisma ${args.join(' ')} returned ${result.status}; expected ${expected}.\n${result.stdout}\n${result.stderr}`)
  }
  return `${result.stdout}\n${result.stderr}`
}

async function resetDatabase(name) {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.query(`CREATE DATABASE "${name}"`)
}

async function withDatabase(name, fn) {
  const client = new Client({ connectionString: databaseUrl(name) })
  await client.connect()
  try { return await fn(client) } finally { await client.end() }
}

try {
  await admin.connect()
  for (const name of names) await resetDatabase(name)

  const freshUrl = databaseUrl(names[0])
  prisma(['migrate', 'deploy'], freshUrl)
  await withDatabase(names[0], async (db) => {
    const objects = await db.query(`
      SELECT count(*)::int AS count FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'AuditEvent_append_only', 'FacilityVisit_verified_exit_check',
        'FacilityAccess_tenant_check', 'BayObservation_slot_facility_check'
      )`)
    if (objects.rows[0].count !== 4) throw new Error('Fresh migration chain did not install all expected custom triggers.')
  })
  prisma(['migrate', 'diff', '--from-url', freshUrl, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], freshUrl)
  console.log('Fresh-empty migration path passed: baseline + forward migration, trigger check, Prisma schema diff.')

  const adoptionUrl = databaseUrl(names[1])
  await withDatabase(names[1], async (db) => {
    await db.query(migrationSql)
    await db.query(`INSERT INTO "User" (id,email,"passwordHash",name,role) VALUES ('legacy-user','legacy@example.test','hash','Legacy','OWNER')`)
    await db.query(`INSERT INTO "Facility" (id,name,address,city,"totalSlots",lat,lng) VALUES ('legacy-facility','Legacy','Test Road','Test City',1,0,0)`)
    prisma(['migrate', 'diff', '--from-url', adoptionUrl, '--to-schema-datamodel', 'prisma/baseline-schema.prisma', '--exit-code'], adoptionUrl)
  })
  prisma(['migrate', 'resolve', '--applied', '20261015100000_baseline'], adoptionUrl)
  prisma(['migrate', 'deploy'], adoptionUrl)
  await withDatabase(names[1], async (db) => {
    const legacy = await db.query(`SELECT u.id, f."organizationId", f."allowPublicReservations" FROM "User" u CROSS JOIN "Facility" f WHERE u.id='legacy-user' AND f.id='legacy-facility'`)
    if (legacy.rowCount !== 1 || legacy.rows[0].organizationId !== null || legacy.rows[0].allowPublicReservations !== false) {
      throw new Error('Adoption changed or lost the legacy user/facility record.')
    }
    const migrations = await db.query(`SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name`)
    if (migrations.rows.map((row) => row.migration_name).join(',') !== expectedMigrationChain) {
      throw new Error('Adoption recorded an unexpected migration chain.')
    }
  })
  console.log('Existing-schema adoption path passed: exact old-schema diff, resolve baseline, additive migration, legacy data retained.')

  const driftUrl = databaseUrl(names[2])
  await withDatabase(names[2], async (db) => {
    await db.query(migrationSql)
    await db.query(`ALTER TABLE "Facility" ADD COLUMN "deliberateTestDrift" TEXT`)
    const output = prisma(['migrate', 'diff', '--from-url', driftUrl, '--to-schema-datamodel', 'prisma/baseline-schema.prisma', '--exit-code'], driftUrl, 2)
    if (!output.trim()) throw new Error('Drift guard returned a difference exit code without describing drift.')
    const history = await db.query(`SELECT to_regclass('public._prisma_migrations') AS migrations`)
    if (history.rows[0].migrations !== null) throw new Error('Drift check modified migration history before refusing adoption.')
  })
  console.log('Schema drift refusal passed: diff failed before baseline resolution and left migration history untouched.')

  prisma(['migrate', 'deploy'], databaseUrl(names[3]))
  integrationReady = true
  console.log('Disposable service-test database migrated and left ready for test:postgres:integration.')
} finally {
  if (admin._connected) {
    for (const name of integrationReady ? names.slice(0, 3) : names) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {})
    await admin.end()
  }
}
