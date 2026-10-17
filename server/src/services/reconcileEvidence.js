import { evaluateBayEvidence } from '../vehicleLifecycle.js'

export async function reconcileSlotEvidence(tx, { slotId, now = new Date() }) {
  const slot = await tx.parkingSlot.findUnique({
    where: { id: slotId },
    include: { zone: { include: { facility: { select: { id: true, organizationId: true } } } } }
  })
  if (!slot?.zone.facility.organizationId) return { state: 'UNKNOWN', changed: false }

  const observations = await tx.bayObservation.findMany({
    where: { facilityId: slot.zone.facility.id, slotId },
    orderBy: { observedAt: 'desc' },
    take: 100,
    select: { id: true, source: true, result: true, observedAt: true }
  })
  const decision = evaluateBayEvidence(observations, { now })
  if (decision.state === 'CONFLICTING') {
    let discrepancy = await tx.discrepancy.findFirst({
      where: { facilityId: slot.zone.facility.id, slotId, kind: 'BAY_EVIDENCE_CONFLICT', status: 'OPEN' }
    })
    if (!discrepancy) {
      discrepancy = await tx.discrepancy.create({
        data: {
          organizationId: slot.zone.facility.organizationId,
          facilityId: slot.zone.facility.id,
          slotId,
          kind: 'BAY_EVIDENCE_CONFLICT',
          summary: 'Current bay evidence reports conflicting occupancy states.'
        }
      })
      await tx.auditEvent.create({
        data: {
          organizationId: slot.zone.facility.organizationId,
          facilityId: slot.zone.facility.id,
          actorSystem: 'bay-evidence-reconciler',
          action: 'BAY_DISCREPANCY_OPENED',
          resourceType: 'Discrepancy',
          resourceId: discrepancy.id,
          afterState: { kind: discrepancy.kind, slotId }
        }
      })
    }
    for (const observationId of decision.evidenceIds) {
      await tx.discrepancyEvidence.upsert({
        where: { discrepancyId_observationId: { discrepancyId: discrepancy.id, observationId } },
        create: { discrepancyId: discrepancy.id, observationId },
        update: {}
      })
    }
    return { state: 'CONFLICTING', changed: false, discrepancyId: discrepancy.id }
  }

  if (!['OCCUPIED', 'VACANT'].includes(decision.state) || !['AVAILABLE', 'OCCUPIED'].includes(slot.status)) {
    return { state: decision.state, changed: false }
  }
  const latest = observations.find(({ id }) => decision.evidenceIds.includes(id))
  const targetStatus = decision.state === 'OCCUPIED' ? 'OCCUPIED' : 'AVAILABLE'
  if (!latest || latest.observedAt <= slot.updatedAt || slot.status === targetStatus) {
    return { state: decision.state, changed: false }
  }

  const update = await tx.parkingSlot.updateMany({
    where: { id: slot.id, status: slot.status, updatedAt: { lt: latest.observedAt } },
    data: { status: targetStatus }
  })
  if (update.count !== 1) return { state: 'UNKNOWN', changed: false }

  await tx.auditEvent.create({
    data: {
      organizationId: slot.zone.facility.organizationId,
      facilityId: slot.zone.facility.id,
      actorSystem: 'bay-evidence-reconciler',
      action: 'BAY_STATE_UPDATED_FROM_EVIDENCE',
      resourceType: 'ParkingSlot',
      resourceId: slot.id,
      beforeState: { status: slot.status },
      afterState: { status: targetStatus, evidenceIds: decision.evidenceIds }
    }
  })
  return { state: decision.state, changed: true }
}
