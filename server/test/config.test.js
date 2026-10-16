import test from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, validateRuntimeConfig } from '../src/config.js'

test('runtime configuration rejects a missing or short signing key', () => {
  const config = createConfig({ DATABASE_URL: 'postgresql://localhost/test' })
  assert.throws(() => validateRuntimeConfig(config), /JWT_SECRET/)
})

test('runtime configuration rejects a missing database URL', () => {
  const config = createConfig({ JWT_SECRET: 'a'.repeat(40) })
  assert.throws(() => validateRuntimeConfig(config), /DATABASE_URL/)
})

test('production requires HTTPS and legacy device authentication is opt-in with a near cutoff', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    JWT_SECRET: 'a'.repeat(40),
    FRONTEND_URL: 'https://example.test'
  }
  assert.doesNotThrow(() => validateRuntimeConfig(createConfig(base)))
  assert.throws(
    () => validateRuntimeConfig(createConfig({ ...base, FRONTEND_URL: 'http://example.test' })),
    /HTTPS/
  )
  assert.throws(() => validateRuntimeConfig(createConfig({ ...base, ALLOW_LEGACY_DEVICE_API_KEY: 'true' })), /explicit cutoff/)
  assert.throws(() => validateRuntimeConfig(createConfig({
    ...base,
    ALLOW_LEGACY_DEVICE_API_KEY: 'true',
    LEGACY_DEVICE_API_KEY: 'b'.repeat(40),
    LEGACY_DEVICE_API_KEY_EXPIRES_AT: new Date(Date.now() - 1000).toISOString()
  })), /explicit cutoff/)
  assert.doesNotThrow(() => validateRuntimeConfig(createConfig({
    ...base,
    ALLOW_LEGACY_DEVICE_API_KEY: 'true',
    LEGACY_DEVICE_API_KEY: 'b'.repeat(40),
    LEGACY_DEVICE_API_KEY_EXPIRES_AT: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  })))
})
