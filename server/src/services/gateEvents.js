import { evaluateInbound, evaluateOutbound, isPseudonymousVehicleReference } from '../vehicleLifecycle.js'

function requiresReview(tx, event, organizationId) {
  return tx.discrepancy.create({
    data: {
      organizationId,
      facilityId: event.facilityId,
      kind: 'GATE_EVENT_REVIEW',
      summary: 'A gate event needs operator review.',
      gateEventId: event.id
    }
  }).then(async (discrepancy) => {
    await tx.auditEvent.create({
      data: {
        organizationId,
        facilityId: event.facilityId,
        actorSystem: 'trusted-gate-adapter',
        action: 'GATE_EVENT_REVIEW_OPENED',
        resourceType: 'Discrepancy',
        resourceId: discrepancy.id,
        afterState: { kind: discrepancy.kind, gateEventId: event.id }
      }
    })
    return discrepancy
  })
}

// Call only after a trusted gate integration has validated the direction and
// event provenance. Device-supplied confidence is not treated as verification.
export async function processVerifiedGateEvent(prisma, input) {
  try {
    return await prisma.$transaction(async (tx) => {
    const eventAt = new Date(input.eventAt)
    if (!Number.isFinite(eventAt.getTime())) throw new Error('Gate event timestamp is invalid.')
    if (!/^[a-f0-9]{64}$/i.test(input.sourceEventId || '') || !/^[a-f0-9]{64}$/i.test(input.deduplicationKey || '')) {
      throw new Error('Gate event IDs must be keyed, non-reversible 64-character hexadecimal references.')
    }
    const facility = await tx.facility.findUnique({ where: { id: input.facilityId } })
    if (!facility?.organizationId || facility.organizationId !== input.organizationId) {
      throw new Error('Facility is not assigned to the supplied organization.')
    }

    const existing = await tx.gateEvent.findFirst({
      where: {
        OR: [
          { deduplicationKey: input.deduplicationKey },
          { facilityId: facility.id, sourceEventId: input.sourceEventId }
        ]
      }
    })
    if (existing) return { action: 'DUPLICATE_EVENT', gateEventId: existing.id, visitId: existing.visitId }

    const vehicleReference = isPseudonymousVehicleReference(input.vehicleReference) ? input.vehicleReference : null
    const validation = input.validation === 'REJECTED'
      ? 'REJECTED'
      : input.validation === 'VERIFIED' && vehicleReference
        ? 'VERIFIED'
        : 'REVIEW_REQUIRED'

    const event = await tx.gateEvent.create({
      data: {
        organizationId: facility.organizationId,
        facilityId: facility.id,
        deviceId: input.deviceId || null,
        sourceEventId: input.sourceEventId,
        deduplicationKey: input.deduplicationKey,
        direction: input.direction,
        validation,
        vehicleReference,
        eventAt,
        provenance: 'trusted-gate-adapter',
        payloadDigest: null
      }
    })

    if (event.validation !== 'VERIFIED' || !event.vehicleReference) {
      await requiresReview(tx, event, facility.organizationId)
      await tx.gateEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
      return { action: 'REVIEW', gateEventId: event.id }
    }

    if (event.direction === 'INBOUND') {
      const activeVisit = await tx.facilityVisit.findFirst({
        where: { facilityId: facility.id, vehicleReference: event.vehicleReference, exitedAt: null },
        orderBy: { inboundAt: 'desc' }
      })
      const latestVisit = activeVisit || await tx.facilityVisit.findFirst({
        where: { facilityId: facility.id, vehicleReference: event.vehicleReference },
        orderBy: { inboundAt: 'desc' }
      })
      const decision = evaluateInbound({ event, activeVisit, latestVisit })
      if (decision.action === 'DUPLICATE') {
        await tx.gateEvent.update({ where: { id: event.id }, data: { visitId: decision.visitId, processedAt: new Date() } })
        return { action: decision.action, gateEventId: event.id, visitId: decision.visitId }
      }
      if (decision.action !== 'OPEN_VISIT') {
        await tx.gateEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
        await requiresReview(tx, event, facility.organizationId)
        return { action: 'REVIEW', gateEventId: event.id, reason: decision.reason }
      }

      const visit = await tx.facilityVisit.create({
        data: {
          organizationId: facility.organizationId,
          facilityId: facility.id,
          vehicleReference: event.vehicleReference,
          inboundEventId: event.id,
          inboundAt: event.eventAt,
          status: 'ACTIVE',
            provenance: event.provenance
        }
      })
      await tx.gateEvent.update({ where: { id: event.id }, data: { visitId: visit.id, processedAt: new Date() } })
      await tx.auditEvent.create({
        data: {
          organizationId: facility.organizationId,
          facilityId: facility.id,
          actorSystem: 'trusted-gate-adapter',
          action: 'FACILITY_VISIT_OPENED',
          resourceType: 'FacilityVisit',
          resourceId: visit.id,
          afterState: { status: 'ACTIVE', inboundAt: event.eventAt.toISOString() }
        }
      })
      return { action: 'OPEN_VISIT', gateEventId: event.id, visitId: visit.id }
    }

    const visit = await tx.facilityVisit.findFirst({
      where: { facilityId: facility.id, vehicleReference: event.vehicleReference, exitedAt: null },
      orderBy: { inboundAt: 'desc' }
    })
    if (!visit) {
      const repeatedExit = await tx.facilityVisit.findFirst({
        where: {
          facilityId: facility.id,
          vehicleReference: event.vehicleReference,
          status: 'EXITED',
          outboundEvent: { eventAt: event.eventAt }
        },
        select: { id: true }
      })
      if (repeatedExit) {
        await tx.gateEvent.update({ where: { id: event.id }, data: { visitId: repeatedExit.id, processedAt: new Date() } })
        return { action: 'DUPLICATE', gateEventId: event.id, visitId: repeatedExit.id }
      }
    }
    const decision = evaluateOutbound({ event, visit })
    if (decision.action !== 'CLOSE_VISIT') {
      await tx.gateEvent.update({ where: { id: event.id }, data: { visitId: decision.visitId || null, processedAt: new Date() } })
      await requiresReview(tx, event, facility.organizationId)
      return { action: decision.action, gateEventId: event.id, reason: decision.reason }
    }

    const closedVisit = await tx.facilityVisit.update({
      where: { id: visit.id },
      data: { status: 'EXITED', exitedAt: event.eventAt, outboundEventId: event.id }
    })
    await tx.gateEvent.update({ where: { id: event.id }, data: { visitId: visit.id, processedAt: new Date() } })
    await tx.auditEvent.create({
      data: {
        organizationId: facility.organizationId,
        facilityId: facility.id,
        actorSystem: 'trusted-gate-adapter',
        action: 'FACILITY_VISIT_CLOSED',
        resourceType: 'FacilityVisit',
        resourceId: visit.id,
        beforeState: { status: visit.status },
        afterState: { status: closedVisit.status, exitedAt: event.eventAt.toISOString() }
      }
    })
    return { action: 'CLOSE_VISIT', gateEventId: event.id, visitId: visit.id }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await prisma.gateEvent.findFirst({
        where: {
          OR: [
            { deduplicationKey: input.deduplicationKey },
            { facilityId: input.facilityId, sourceEventId: input.sourceEventId }
          ]
        }
      })
      if (existing) return { action: 'DUPLICATE_EVENT', gateEventId: existing.id, visitId: existing.visitId }
    }
    throw error
  }
}
