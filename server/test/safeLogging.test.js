import test from 'node:test'
import assert from 'node:assert/strict'
import { logProcessError } from '../src/safeLogging.js'

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
