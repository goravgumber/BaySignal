import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { accessibleFacilityIds, hasFacilityAccess } from '../tenantAccess.js'
import { reconcileSlotEvidence } from '../services/reconcileEvidence.js'

const router = Router()
const discrepancyQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() })
const resolveSchema = z.object({
  status: z.enum(['AVAILABLE', 'OCCUPIED']),
  reason: z.string().trim().min(10).max(500)
})
const auditQuery = z.object({ facilityId: z.string().uuid().optional(), limit: z.string().regex(/^\d+$/).optional() })

router.get('/audit', authMiddleware, validateQuery(auditQuery), async (req, res, next) => {
  try {
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'audit_read')
    if (req.query.facilityId && !facilityIds.includes(req.query.facilityId)) {
      return res.status(404).json({ success: false, error: 'Facility not found.', code: 404 })
    }
    const orgAdminMemberships = req.user.role === 'PLATFORM_ADMIN'
      ? []
      : await prisma.organizationMembership.findMany({
          where: { userId: req.user.id, role: 'ORG_ADMIN', status: 'ACTIVE' },
          select: { organizationId: true }
        })
    const auditWhere = req.user.role === 'PLATFORM_ADMIN'
      ? {}
      : req.query.facilityId
        ? { facilityId: req.query.facilityId }
        : {
            OR: [
              { facilityId: { in: facilityIds } },
              { organizationId: { in: orgAdminMemberships.map(({ organizationId }) => organizationId) } }
            ]
          }
    const events = await prisma.auditEvent.findMany({
      where: auditWhere,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(Number(req.query.limit) || 50, 1), 100),
      select: {
        id: true,
        organizationId: true,
        facilityId: true,
        actorUserId: true,
        actorSystem: true,
        action: true,
        resourceType: true,
        resourceId: true,
        reason: true,
        beforeState: true,
        afterState: true,
        occurredAt: true
      }
    })
    res.json({ success: true, data: events })
  } catch (error) {
    next(error)
  }
})

router.get('/visits', authMiddleware, async (req, res, next) => {
  try {
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'operations_read')
    const visits = await prisma.facilityVisit.findMany({
      where: { facilityId: { in: facilityIds } },
      orderBy: { inboundAt: 'desc' },
      take: 100,
      select: {
        id: true,
        facilityId: true,
        vehicleReference: true,
        inboundAt: true,
        exitedAt: true,
        status: true,
        provenance: true,
        currentBayId: true,
        reservationId: true,
        createdAt: true,
        updatedAt: true
      }
    })
    res.json({ success: true, data: visits })
  } catch (error) {
    next(error)
  }
})

router.post('/slots/:slotId/reconcile', authMiddleware, async (req, res, next) => {
  try {
    const slot = await prisma.parkingSlot.findUnique({
      where: { id: req.params.slotId },
      include: { zone: { select: { facilityId: true } } }
    })
    if (!slot || !(await hasFacilityAccess(prisma, req.user, slot.zone.facilityId, 'correction_write'))) {
      return res.status(404).json({ success: false, error: 'Parking slot not found.', code: 404 })
    }
    const result = await prisma.$transaction(
      (tx) => reconcileSlotEvidence(tx, { slotId: slot.id }),
      { isolationLevel: 'Serializable' }
    )
    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

router.get('/discrepancies', authMiddleware, validateQuery(discrepancyQuery), async (req, res, next) => {
  try {
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'operations_read')
    const discrepancies = await prisma.discrepancy.findMany({
      where: {
        facilityId: { in: facilityIds },
        ...(req.query.status ? { status: req.query.status } : {})
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
      include: {
        evidence: {
          include: { observation: { select: { id: true, source: true, result: true, observedAt: true, receivedAt: true, confidence: true } } }
        }
      }
    })
    res.json({ success: true, data: discrepancies })
  } catch (error) {
    next(error)
  }
})

router.post('/discrepancies/:id/resolve', authMiddleware, validateBody(resolveSchema), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const discrepancy = await tx.discrepancy.findUnique({
        where: { id: req.params.id },
        include: { facility: true, slot: true }
      })
      if (!discrepancy || !(await hasFacilityAccess(tx, req.user, discrepancy.facilityId, 'correction_write'))) {
        const error = new Error('Discrepancy not found.')
        error.statusCode = 404
        throw error
      }
      if (discrepancy.status !== 'OPEN' || !discrepancy.slot) {
        const error = new Error('This discrepancy cannot be resolved as a bay correction.')
        error.statusCode = 409
        throw error
      }

      const before = discrepancy.slot.status
      const updatedSlot = await tx.parkingSlot.update({
        where: { id: discrepancy.slot.id },
        data: { status: req.body.status }
      })
      const observation = await tx.bayObservation.create({
        data: {
          organizationId: discrepancy.facility.organizationId,
          facilityId: discrepancy.facilityId,
          slotId: discrepancy.slot.id,
          source: 'ATTENDANT',
          sourceReference: req.user.id,
          deduplicationKey: `correction:${randomUUID()}`,
          result: req.body.status === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT',
          observedAt: new Date(),
          details: { correctionReason: req.body.reason }
        }
      })
      const updatedDiscrepancy = await tx.discrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedById: req.user.id,
          resolution: req.body.reason,
          evidence: { create: { observationId: observation.id } }
        }
      })
      const audit = await tx.auditEvent.create({
        data: {
          organizationId: discrepancy.facility.organizationId,
          facilityId: discrepancy.facilityId,
          actorUserId: req.user.id,
          action: 'BAY_STATE_CORRECTED',
          resourceType: 'ParkingSlot',
          resourceId: updatedSlot.id,
          reason: req.body.reason,
          beforeState: { status: before },
          afterState: { status: updatedSlot.status, observationId: observation.id, discrepancyId: discrepancy.id }
        }
      })
      return { discrepancy: updatedDiscrepancy, slot: updatedSlot, auditEventId: audit.id }
    }, { isolationLevel: 'Serializable' })
    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

export default router
