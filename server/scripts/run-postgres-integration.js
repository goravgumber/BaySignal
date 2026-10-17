import { spawnSync } from 'node:child_process'
import pg from 'pg'

if (process.env.BAYSIGNAL_PG_INTEGRATION !== '1') {
  throw new Error('Set BAYSIGNAL_PG_INTEGRATION=1 to explicitly enable PostgreSQL integration tests.')
}
if (process.env.BAYSIGNAL_TEST_DB_CONFIRMATION !== 'EPHEMERAL-POSTGRES') {
  throw new Error('Set BAYSIGNAL_TEST_DB_CONFIRMATION=EPHEMERAL-POSTGRES only for a disposable PostgreSQL service.')
}
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the disposable integration database.')
const target = new URL(process.env.DATABASE_URL)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.port !== '5432' || target.search || target.hash || target.pathname !== '/baysignal_test_integration') {
  throw new Error('Refusing PostgreSQL integration tests unless DATABASE_URL targets baysignal_test_integration on loopback port 5432 without URL overrides.')
}

const result = spawnSync(process.execPath, ['--test', 'test/postgres.integration.test.js'], { stdio: 'inherit' })
if (result.error) throw result.error
const testStatus = result.status ?? 1
const adminUrl = new URL(process.env.DATABASE_URL)
adminUrl.pathname = '/postgres'
const admin = new pg.Client({ connectionString: adminUrl.toString() })
await admin.connect()
try {
  await admin.query('DROP DATABASE IF EXISTS "baysignal_test_integration" WITH (FORCE)')
} finally {
  await admin.end()
}
process.exitCode = testStatus
