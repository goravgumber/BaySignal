const sensorMutableStatuses = new Set(['AVAILABLE', 'OCCUPIED'])

export function isObservationCurrent(slot, observedAt) {
  const timestamp = observedAt instanceof Date ? observedAt : new Date(observedAt)
  return (
    Number.isFinite(timestamp.getTime()) &&
    sensorMutableStatuses.has(slot.status) &&
    slot.updatedAt instanceof Date &&
    slot.updatedAt < timestamp
  )
}
