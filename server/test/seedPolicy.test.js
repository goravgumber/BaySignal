import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSeedEnvironment } from '../src/seedPolicy.js'

test('demo seed is opt-in and cannot run in production', () => {
  assert.throws(() => validateSeedEnvironment({}), /ALLOW_DEMO_SEED/)
  assert.throws(
    () => validateSeedEnvironment({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true', SEED_DEMO_PASSWORD: 'x'.repeat(20) }),
    /disabled in production/
  )
  assert.throws(
    () => validateSeedEnvironment({ ALLOW_DEMO_SEED: 'true' }),
    /SEED_DEMO_PASSWORD/
  )
  assert.equal(
    validateSeedEnvironment({ ALLOW_DEMO_SEED: 'true', SEED_DEMO_PASSWORD: 'x'.repeat(20) }).length,
    20
  )
})
