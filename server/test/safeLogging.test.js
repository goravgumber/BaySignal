import test from 'node:test'
import assert from 'node:assert/strict'
import { logDiagnostic, logProcessError } from '../src/safeLogging.js'

test('process error logs omit exception messages and attached secrets', () => {
  let output = ''
  const originalError = console.error
  console.error = (...parts) => { output = parts.join(' ') }
  try {
    logProcessError('fatal_startup_error', Object.assign(new Error('DATABASE_URL=secret-value'), { code: 'P1001', token: 'private-token' }))
  } finally {
    console.error = originalError
  }
  assert.ok(output.includes('fatal_startup_error'))
  assert.ok(output.includes('P1001'))
  assert.equal(output.includes('secret-value'), false)
  assert.equal(output.includes('private-token'), false)
})

test('logDiagnostic redacts sensitive keys and preserves non-sensitive metadata', () => {
  let warnOutput = ''
  let infoOutput = ''
  const originalWarn = console.warn
  const originalInfo = console.info
  console.warn = (...parts) => { warnOutput = parts.join(' ') }
  console.info = (...parts) => { infoOutput = parts.join(' ') }

  try {
    logDiagnostic('device_auth_rejected', {
      reason: 'invalid_signature',
      deviceId: 'dev-123',
      token: 'sensitive-jwt-token',
      signature: 'unpadded-base64url-signature',
      rawBody: 'raw-body-content',
      nested: {
        apiKey: 'secret-key-material',
        safeCount: 5
      }
    })

    assert.ok(warnOutput.includes('device_auth_rejected'))
    assert.ok(warnOutput.includes('dev-123'))
    assert.ok(warnOutput.includes('invalid_signature'))
    assert.ok(warnOutput.includes('[REDACTED]'))
    assert.equal(warnOutput.includes('sensitive-jwt-token'), false)
    assert.equal(warnOutput.includes('unpadded-base64url-signature'), false)
    assert.equal(warnOutput.includes('raw-body-content'), false)
    assert.equal(warnOutput.includes('secret-key-material'), false)

    logDiagnostic('pilot_diagnostic_event', {
      deviceId: 'dev-456',
      status: 'ONLINE'
    })
    assert.ok(infoOutput.includes('pilot_diagnostic_event'))
    assert.ok(infoOutput.includes('dev-456'))
  } finally {
    console.warn = originalWarn
    console.info = originalInfo
  }
})
