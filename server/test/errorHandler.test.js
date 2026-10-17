import test from 'node:test'
import assert from 'node:assert/strict'
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js'

test('404 responses do not reflect query strings or untrusted paths', () => {
  let body
  const response = {
    status(code) { this.statusCode = code; return this },
    json(value) { body = value; return this }
  }

  notFoundHandler({ method: 'GET', originalUrl: '/missing?token=do-not-echo' }, response)

  assert.equal(response.statusCode, 404)
  assert.equal(body.error, 'Route not found.')
  assert.equal(JSON.stringify(body).includes('do-not-echo'), false)
})

test('server error logs contain correlation metadata without exception messages', () => {
  let body
  let logLine
  const originalError = console.error
  console.error = (...parts) => { logLine = parts.join(' ') }
  const response = {
    status(code) { this.statusCode = code; return this },
    json(value) { body = value; return this }
  }

  try {
    errorHandler(
      Object.assign(new Error('private value must not enter logs'), { code: 'P2002' }),
      { method: 'POST', route: { path: '/api/reservations' } },
      response,
      () => {}
    )
  } finally {
    console.error = originalError
  }

  assert.equal(response.statusCode, 500)
  assert.equal(body.error, 'Internal Server Error')
  assert.ok(body.requestId)
  assert.ok(logLine.includes(body.requestId))
  assert.ok(logLine.includes('P2002'))
  assert.equal(logLine.includes('private value'), false)
})
