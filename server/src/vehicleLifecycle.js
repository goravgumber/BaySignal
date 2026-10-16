export function isPseudonymousVehicleReference(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

export function evaluateInbound({ event, activeVisit, latestVisit }) {
  if (event.direction !== 'INBOUND' || event.validation !== 'VERIFIED' || !isPseudonymousVehicleReference(event.vehicleReference)) {
    return { action: 'REVIEW', reason: 'Inbound event is not verified or has no stable vehicle reference.' }
  }
  if (!Number.isFinite(new Date(event.eventAt).getTime())) {
    return { action: 'REVIEW', reason: 'Inbound event timestamp is invalid.' }
  }
  if (activeVisit) {
    if (activeVisit.vehicleReference === event.vehicleReference && new Date(event.eventAt) >= new Date(activeVisit.inboundAt)) {
      return { action: 'DUPLICATE', visitId: activeVisit.id }
    }
    return { action: 'REVIEW', reason: 'Another active visit exists for this vehicle reference.' }
  }
  if (latestVisit && new Date(event.eventAt) <= new Date(latestVisit.inboundAt)) {
    return { action: 'REVIEW', reason: 'Inbound event is older than the most recent visit.' }
  }
  return { action: 'OPEN_VISIT' }
}

export function evaluateOutbound({ event, visit }) {
  if (event.direction !== 'OUTBOUND' || event.validation !== 'VERIFIED' || !isPseudonymousVehicleReference(event.vehicleReference)) {
    return { action: 'REVIEW', reason: 'Outbound event is not verified or has no stable vehicle reference.' }
  }
  if (!Number.isFinite(new Date(event.eventAt).getTime())) {
    return { action: 'REVIEW', reason: 'Outbound event timestamp is invalid.' }
  }
  if (!visit) return { action: 'REVIEW', reason: 'No matching facility visit exists.' }
  if (visit.vehicleReference !== event.vehicleReference) {
    return { action: 'REVIEW', reason: 'Vehicle reference does not match the visit.' }
  }
  if (visit.status === 'EXITED') return { action: 'DUPLICATE', visitId: visit.id }
  if (visit.status !== 'ACTIVE') return { action: 'REVIEW', reason: 'Visit is not in an active state.' }
  if (new Date(event.eventAt) < new Date(visit.inboundAt)) {
    return { action: 'REVIEW', reason: 'Outbound event predates the inbound event.' }
  }
  return { action: 'CLOSE_VISIT', visitId: visit.id }
}

export function evaluateBayEvidence(observations, { now = new Date(), maxAgeSeconds = 120, includeSimulation = false } = {}) {
  const trustedSources = new Set(['BAY_SENSOR', 'OVERHEAD_CAMERA', 'ATTENDANT', ...(includeSimulation ? ['SIMULATION'] : [])])
  const usable = observations.filter((observation) => {
    if (!trustedSources.has(observation.source) || observation.result === 'UNKNOWN') return false
    const ageSeconds = (now.getTime() - new Date(observation.observedAt).getTime()) / 1000
    return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds
  })
  if (usable.length === 0) return { state: 'UNKNOWN', evidenceIds: [] }

  const latestBySource = new Map()
  for (const observation of usable) {
    const previous = latestBySource.get(observation.source)
    if (!previous || new Date(observation.observedAt) > new Date(previous.observedAt)) {
      latestBySource.set(observation.source, observation)
    }
  }
  const latest = [...latestBySource.values()]
  const results = new Set(latest.map(({ result }) => result))
  if (results.has('CONFLICTING') || (results.has('OCCUPIED') && results.has('VACANT'))) {
    return { state: 'CONFLICTING', evidenceIds: latest.map(({ id }) => id) }
  }
  if (results.has('OCCUPIED')) return { state: 'OCCUPIED', evidenceIds: latest.map(({ id }) => id) }
  if (results.has('VACANT')) return { state: 'VACANT', evidenceIds: latest.map(({ id }) => id) }
  return { state: 'UNKNOWN', evidenceIds: latest.map(({ id }) => id) }
}
