import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { getIO } from '../socket.js'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { accessibleFacilityIds, hasFacilityAccess } from '../tenantAccess.js'

const router = Router()
const listQuerySchema = z.object({
  facilityId: z.string().uuid().optional(),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO']).optional(),
  resolved: z.enum(['true', 'false']).optional()
})
const createAlertSchema = z.object({
  facilityId: z.string().uuid(),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO']),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(500)
})
const resolveAlertSchema = z.object({ reason: z.string().trim().min(10).max(500) })

router.get('/', authMiddleware, validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const { facilityId, severity, resolved } = req.query
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'alerts_read')
    if (facilityId && !facilityIds.includes(String(facilityId))) {
      return res.status(404).json({ success: false, error: 'Facility not found.', code: 404 })
    }

    const where = {
      facilityId: facilityId ? String(facilityId) : { in: facilityIds },
      ...(severity ? { severity: String(severity).toUpperCase() } : {}),
      ...(typeof resolved !== 'undefined' ? { isResolved: String(resolved) === 'true' } : {})
    }

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })

    res.json({ success: true, data: alerts })
  } catch (error) {
    next(error)
  }
})

router.post('/', authMiddleware, validateBody(createAlertSchema), async (req, res, next) => {
  try {
    const { facilityId, severity, title, description } = req.body
    if (!(await hasFacilityAccess(prisma, req.user, facilityId, 'alerts_write'))) {
      return res.status(404).json({ success: false, error: 'Facility not found.', code: 404 })
    }

    const alert = await prisma.$transaction(async (tx) => {
      const created = await tx.alert.create({
        data: { facilityId, severity, title, description }
      })
      await tx.auditEvent.create({
        data: {
          organizationId: (await tx.facility.findUnique({ where: { id: facilityId }, select: { organizationId: true } }))?.organizationId,
          facilityId,
          actorUserId: req.user.id,
          action: 'ALERT_CREATED',
          resourceType: 'Alert',
          resourceId: created.id,
          afterState: { severity: created.severity, title: created.title }
        }
      })
      return created
    })

    const io = getIO()
    if (io) {
      io.to(facilityId).emit('alert:new', alert)
    }

    res.status(201).json({ success: true, data: alert })
  } catch (error) {
    next(error)
  }
})

router.put('/:id/resolve', authMiddleware, validateBody(resolveAlertSchema), async (req, res, next) => {
  try {
    const alert = await prisma.$transaction(async (tx) => {
      const existing = await tx.alert.findUnique({ where: { id: req.params.id } })
      if (!existing || !(await hasFacilityAccess(tx, req.user, existing.facilityId, 'alerts_write'))) {
        const error = new Error('Alert not found.')
        error.statusCode = 404
        throw error
      }
      const updated = await tx.alert.update({ where: { id: existing.id }, data: { isResolved: true } })
      const organization = await tx.facility.findUnique({ where: { id: existing.facilityId }, select: { organizationId: true } })
      await tx.auditEvent.create({
        data: {
          organizationId: organization?.organizationId,
          facilityId: existing.facilityId,
          actorUserId: req.user.id,
          action: 'ALERT_RESOLVED',
          resourceType: 'Alert',
          resourceId: existing.id,
          reason: req.body.reason,
          beforeState: { isResolved: existing.isResolved },
          afterState: { isResolved: true }
        }
      })
      return updated
    })

    const io = getIO()
    if (io) {
      io.to(alert.facilityId).emit('alert:resolved', alert)
    }

    res.json({ success: true, data: alert })
  } catch (error) {
    next(error)
  }
})

export default router
