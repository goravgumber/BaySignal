import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBayEvidence, evaluateInbound, evaluateOutbound } from '../src/vehicleLifecycle.js'

const vehicleReference = 'a'.repeat(64)
const inbound = { direction: 'INBOUND', validation: 'VERIFIED', vehicleReference, eventAt: '2026-10-15T10:00:00.000Z' }
const activeVisit = { id: 'visit-1', status: 'ACTIVE', vehicleReference, inboundAt: '2026-10-15T10:00:00.000Z' }

test('verified entry opens facility presence without requiring a bay assignment', () => {
  assert.deepEqual(evaluateInbound({ event: inbound }), { action: 'OPEN_VISIT' })
})

test('raw or malformed plate references cannot create a visit', () => {
  assert.equal(evaluateInbound({ event: { ...inbound, vehicleReference: 'MH02AB1234' } }).action, 'REVIEW')
})

test('a future reservation is contextual evidence and cannot establish bay occupancy', () => {
  const result = evaluateBayEvidence([
    { id: 'reservation', source: 'RESERVATION_CONTEXT', result: 'OCCUPIED', observedAt: '2026-10-15T10:00:00Z' }
  ], { now: new Date('2026-10-15T10:00:30Z') })
  assert.equal(result.state, 'UNKNOWN')
})

test('leaving a bay and stale vacancy evidence do not close or update facility presence', () => {
  const result = evaluateBayEvidence([
    { id: 'old-vacancy', source: 'BAY_SENSOR', result: 'VACANT', observedAt: '2026-10-15T09:50:00Z' },
    { id: 'new-occupied', source: 'BAY_SENSOR', result: 'OCCUPIED', observedAt: '2026-10-15T10:00:00Z' }
  ], { now: new Date('2026-10-15T10:00:05Z'), maxAgeSeconds: 120 })
  assert.equal(result.state, 'OCCUPIED')
  assert.equal(evaluateInbound({ event: inbound, activeVisit }).action, 'DUPLICATE')
})

test('conflicting current sources remain unresolved', () => {
  const result = evaluateBayEvidence([
    { id: 'sensor', source: 'BAY_SENSOR', result: 'OCCUPIED', observedAt: '2026-10-15T10:00:00Z' },
    { id: 'camera', source: 'OVERHEAD_CAMERA', result: 'VACANT', observedAt: '2026-10-15T10:00:01Z' }
  ], { now: new Date('2026-10-15T10:00:05Z') })
  assert.equal(result.state, 'CONFLICTING')
})

test('unverified or stale outbound events cannot close a visit', () => {
  assert.equal(evaluateOutbound({ event: { ...inbound, direction: 'OUTBOUND', validation: 'REVIEW_REQUIRED' }, visit: activeVisit }).action, 'REVIEW')
  assert.equal(evaluateOutbound({ event: { ...inbound, direction: 'OUTBOUND', eventAt: '2026-10-15T09:59:00Z' }, visit: activeVisit }).action, 'REVIEW')
})

test('a verified matching outbound event closes only its active visit', () => {
  assert.equal(evaluateOutbound({ event: { ...inbound, direction: 'OUTBOUND', eventAt: '2026-10-15T11:00:00Z' }, visit: activeVisit }).action, 'CLOSE_VISIT')
  assert.equal(evaluateOutbound({ event: { ...inbound, direction: 'OUTBOUND' }, visit: null }).action, 'REVIEW')
  assert.equal(evaluateOutbound({ event: { ...inbound, direction: 'OUTBOUND' }, visit: { ...activeVisit, vehicleReference: 'different' } }).action, 'REVIEW')
})

test('duplicate inbound and outbound transitions are idempotent', () => {
  assert.equal(evaluateInbound({ event: inbound, activeVisit }).action, 'DUPLICATE')
  assert.equal(evaluateOutbound({
    event: { ...inbound, direction: 'OUTBOUND' },
    visit: { ...activeVisit, status: 'EXITED' }
  }).action, 'DUPLICATE')
})
