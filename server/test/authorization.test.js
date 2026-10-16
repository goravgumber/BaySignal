import test from 'node:test'
import assert from 'node:assert/strict'
import { requireRoles } from '../src/middleware/auth.js'

function runMiddleware(role, allowed) {
  const middleware = requireRoles(...allowed)
  let nextCalled = false
  let responseStatus = 200
  const response = { status(code) { responseStatus = code; return this }, json() { return this } }
  middleware({ user: role ? { role } : null }, response, () => { nextCalled = true })
  return { nextCalled, responseStatus }
}

test('role checks reject anonymous users and drivers from administrative operations', () => {
  assert.deepEqual(runMiddleware(null, ['OWNER', 'ADMIN']), { nextCalled: false, responseStatus: 403 })
  assert.deepEqual(runMiddleware('DRIVER', ['OWNER', 'ADMIN']), { nextCalled: false, responseStatus: 403 })
})

test('role checks allow only an explicitly listed role', () => {
  assert.deepEqual(runMiddleware('OWNER', ['OWNER', 'ADMIN']), { nextCalled: true, responseStatus: 200 })
  assert.deepEqual(runMiddleware('DRIVER', ['DRIVER']), { nextCalled: true, responseStatus: 200 })
})
