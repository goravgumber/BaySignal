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

test('production requires HTTPS frontend and a strong device key', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    JWT_SECRET: 'a'.repeat(40),
    FRONTEND_URL: 'https://example.test'
  }
  assert.throws(() => validateRuntimeConfig(createConfig(base)), /DEVICE_API_KEY/)
  assert.throws(
    () => validateRuntimeConfig(createConfig({ ...base, DEVICE_API_KEY: 'b'.repeat(40), FRONTEND_URL: 'http://example.test' })),
    /HTTPS/
  )
  assert.doesNotThrow(() => validateRuntimeConfig(createConfig({ ...base, DEVICE_API_KEY: 'b'.repeat(40) })))
})
