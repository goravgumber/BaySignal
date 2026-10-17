const knownStatuses = new Set(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'])

export function getBayDisplayStatus(recordedStatus, reservationHold) {
  if (reservationHold) return ['AVAILABLE', 'RESERVED'].includes(recordedStatus) ? 'RESERVED' : 'CONFLICTING'
  if (recordedStatus === 'RESERVED') return 'UNKNOWN'
  return knownStatuses.has(recordedStatus) ? recordedStatus : 'UNKNOWN'
}

export function summarizeBayRecords(records) {
  const counts = { total: records.length, available: 0, occupied: 0, reserved: 0, disabled: 0, unverified: 0 }
  for (const record of records) {
    const displayStatus = getBayDisplayStatus(record.status, Boolean(record.reservationHold))
    if (displayStatus === 'AVAILABLE') counts.available += 1
    else if (displayStatus === 'OCCUPIED') counts.occupied += 1
    else if (displayStatus === 'RESERVED') counts.reserved += 1
    else if (displayStatus === 'DISABLED') counts.disabled += 1
    else counts.unverified += 1
  }
  counts.occupancyRate = counts.total ? Number(((counts.occupied / counts.total) * 100).toFixed(2)) : 0
  return counts
}
