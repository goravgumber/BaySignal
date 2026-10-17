import test from 'node:test'
import assert from 'node:assert/strict'
import { isObservationCurrent } from '../src/parkingObservations.js'
import { getBayDisplayStatus, summarizeBayRecords } from '../src/reconcileBayState.js'

const current = new Date('2026-10-15T10:00:00.000Z')

test('a newer bay observation can update an ordinary available or occupied bay', () => {
  const observedAt = new Date('2026-10-15T10:00:01.000Z')
  assert.equal(isObservationCurrent({ status: 'AVAILABLE', updatedAt: current }, observedAt), true)
  assert.equal(isObservationCurrent({ status: 'OCCUPIED', updatedAt: current }, observedAt), true)
})

test('a delayed or duplicate observation cannot overwrite a newer bay state', () => {
  assert.equal(isObservationCurrent({ status: 'OCCUPIED', updatedAt: current }, current), false)
  assert.equal(isObservationCurrent({ status: 'AVAILABLE', updatedAt: current }, new Date(current.getTime() - 1)), false)
})

test('sensor observations cannot overwrite reserved or disabled bays', () => {
  const later = new Date(current.getTime() + 1)
  assert.equal(isObservationCurrent({ status: 'RESERVED', updatedAt: current }, later), false)
  assert.equal(isObservationCurrent({ status: 'DISABLED', updatedAt: current }, later), false)
})

test('reservation state stays separate from the recorded bay state', () => {
  assert.equal(getBayDisplayStatus('AVAILABLE', true), 'RESERVED')
  assert.equal(getBayDisplayStatus('RESERVED', true), 'RESERVED')
  assert.equal(getBayDisplayStatus('OCCUPIED', true), 'CONFLICTING')
  assert.equal(getBayDisplayStatus('RESERVED', false), 'UNKNOWN')
})

test('summary categorizes conflicting and legacy reservation records as unverified', () => {
  const summary = summarizeBayRecords([
    { status: 'AVAILABLE', reservationHold: false },
    { status: 'OCCUPIED', reservationHold: false },
    { status: 'AVAILABLE', reservationHold: true },
    { status: 'OCCUPIED', reservationHold: true },
    { status: 'RESERVED', reservationHold: false },
    { status: 'DISABLED', reservationHold: false }
  ])
  assert.deepEqual(summary, { total: 6, available: 1, occupied: 1, reserved: 1, disabled: 1, unverified: 2, occupancyRate: 16.67 })
})
