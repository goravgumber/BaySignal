import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { deviceCanonicalRequest } from '../src/middleware/deviceAuth.js'

test('device signature canonical bytes bind method, exact URL, timestamp, request ID, and raw body', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const rawBody = Buffer.from('{"cpuPercent":10}')
  const canonical = deviceCanonicalRequest({
    method: 'put',
    path: '/api/devices/device-uuid/heartbeat?mode=fast',
    timestamp: '1792140000',
    requestId: '56a7c6bf-ea42-4fc7-a843-e3bc89eaebde',
    rawBody
  })
  const signature = sign(null, Buffer.from(canonical), privateKey)
  assert.equal(verify(null, Buffer.from(canonical), publicKey, signature), true)
  assert.equal(verify(null, Buffer.from(canonical.replace('/heartbeat?mode=fast', '/heartbeat?mode=slow')), publicKey, signature), false)
  assert.equal(verify(null, Buffer.from(canonical.replace('1792140000', '1792140001')), publicKey, signature), false)
  const changedBody = deviceCanonicalRequest({
    method: 'PUT',
    path: '/api/devices/device-uuid/heartbeat?mode=fast',
    timestamp: '1792140000',
    requestId: '56a7c6bf-ea42-4fc7-a843-e3bc89eaebde',
    rawBody: Buffer.from('{"ramPercent":10}')
  })
  assert.equal(verify(null, Buffer.from(changedBody), publicKey, signature), false)
})

test('device signature canonical bytes bind observation ingestion requests', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const rawBody = Buffer.from('{"parking_id":"fac-uuid","timestamp":"2026-10-17T00:00:00Z","slots":{"A-01":"available"}}')
  const canonical = deviceCanonicalRequest({
    method: 'POST',
    path: '/api/devices/device-uuid/observations',
    timestamp: '1792140500',
    requestId: '99a7c6bf-ea42-4fc7-a843-e3bc89eaebdf',
    rawBody
  })
  const signature = sign(null, Buffer.from(canonical), privateKey)
  assert.equal(verify(null, Buffer.from(canonical), publicKey, signature), true)
  assert.equal(verify(null, Buffer.from(canonical.replace('device-uuid', 'other-device')), publicKey, signature), false)
})
