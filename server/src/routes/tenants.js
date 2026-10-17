import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { hasFacilityAccess } from '../tenantAccess.js'

const router = Router()
const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)
})
const facilityAssignmentSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(20).max(500)
})
const membershipSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ORG_ADMIN', 'FACILITY_MANAGER', 'ATTENDANT', 'FINANCE', 'DEVICE_TECHNICIAN', 'DRIVER', 'VIEWER']),
  facilityId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).max(500)
}).superRefine((value, context) => {
  if (value.role === 'ORG_ADMIN' && value.facilityId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Organization administrators receive organization scope, not a facility grant.', path: ['facilityId'] })
  }
  if (value.role !== 'ORG_ADMIN' && !value.facilityId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A facility is required for facility-scoped roles.', path: ['facilityId'] })
  }
})
const suspendSchema = z.object({ reason: z.string().trim().min(10).max(500) })
const publicBookingSchema = z.object({ enabled: z.boolean(), reason: z.string().trim().min(10).max(500) })

function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'Platform administrator access is required.', code: 403 })
  }
  return next()
}

async function requireOrganizationAdmin(tx, userId, organizationId) {
  const membership = await tx.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, role: true, status: true }
  })
  return membership?.status === 'ACTIVE' && membership.role === 'ORG_ADMIN' ? membership : null
}

router.post('/organizations', authMiddleware, requirePlatformAdmin, validateBody(organizationSchema), async (req, res, next) => {
  try {
    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: req.body })
      await tx.auditEvent.create({
        data: {
          organizationId: created.id,
          actorUserId: req.user.id,
          action: 'ORGANIZATION_CREATED',
          resourceType: 'Organization',
          resourceId: created.id,
          afterState: { name: created.name, slug: created.slug }
        }
      })
      return created
    })
    res.status(201).json({ success: true, data: organization })
  } catch (error) {
    next(error)
  }
})

router.post('/facilities/:facilityId/organization', authMiddleware, requirePlatformAdmin, validateBody(facilityAssignmentSchema), async (req, res, next) => {
  try {
    const facility = await prisma.$transaction(async (tx) => {
      const existing = await tx.facility.findUnique({ where: { id: req.params.facilityId } })
      const organization = await tx.organization.findUnique({ where: { id: req.body.organizationId } })
      if (!existing || !organization) {
        const error = new Error('Facility or organization not found.')
        error.statusCode = 404
        throw error
      }
      if (existing.organizationId) {
        const error = new Error('Facility is already assigned. Transfers require a separate reviewed workflow.')
        error.statusCode = 409
        throw error
      }
      const updated = await tx.facility.update({
        where: { id: existing.id },
        data: { organizationId: organization.id }
      })
      await tx.auditEvent.create({
        data: {
          organizationId: organization.id,
          facilityId: existing.id,
          actorUserId: req.user.id,
          action: 'FACILITY_ASSIGNED_TO_ORGANIZATION',
          resourceType: 'Facility',
          resourceId: existing.id,
          reason: req.body.reason,
          beforeState: { organizationId: null },
          afterState: { organizationId: organization.id }
        }
      })
      return updated
    }, { isolationLevel: 'Serializable' })
    res.json({ success: true, data: facility })
  } catch (error) {
    next(error)
  }
})

router.put('/facilities/:facilityId/public-booking', authMiddleware, validateBody(publicBookingSchema), async (req, res, next) => {
  try {
    const facility = await prisma.$transaction(async (tx) => {
      const existing = await tx.facility.findUnique({ where: { id: req.params.facilityId } })
      if (!existing || !(await hasFacilityAccess(tx, req.user, existing.id, 'facility_settings'))) {
        const error = new Error('Facility not found.')
        error.statusCode = 404
        throw error
      }
      const updated = await tx.facility.update({ where: { id: existing.id }, data: { allowPublicReservations: req.body.enabled } })
      await tx.auditEvent.create({
        data: {
          organizationId: existing.organizationId,
          facilityId: existing.id,
          actorUserId: req.user.id,
          action: 'PUBLIC_RESERVATIONS_SETTING_CHANGED',
          resourceType: 'Facility',
          resourceId: existing.id,
          reason: req.body.reason,
          beforeState: { allowPublicReservations: existing.allowPublicReservations },
          afterState: { allowPublicReservations: updated.allowPublicReservations }
        }
      })
      return updated
    })
    res.json({ success: true, data: facility })
  } catch (error) {
    next(error)
  }
})

router.post('/organizations/:organizationId/memberships', authMiddleware, validateBody(membershipSchema), async (req, res, next) => {
  try {
    const organizationId = req.params.organizationId
    if (req.body.role === 'ORG_ADMIN' && req.user.role !== 'PLATFORM_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only a platform administrator can appoint an organization administrator.', code: 403 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const canManage = req.user.role === 'PLATFORM_ADMIN' || await requireOrganizationAdmin(tx, req.user.id, organizationId)
      if (!canManage) {
        const error = new Error('Organization not found.')
        error.statusCode = 404
        throw error
      }
      const organization = await tx.organization.findUnique({ where: { id: organizationId } })
      const targetUser = await tx.user.findUnique({ where: { id: req.body.userId }, select: { id: true } })
      if (!organization || !targetUser) {
        const error = new Error('Organization or user not found.')
        error.statusCode = 404
        throw error
      }
      if (req.body.facilityId) {
        const facility = await tx.facility.findFirst({ where: { id: req.body.facilityId, organizationId } })
        if (!facility) {
          const error = new Error('Facility not found in this organization.')
          error.statusCode = 404
          throw error
        }
      }

      const previous = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId: targetUser.id } }
      })
      if (previous?.role === 'ORG_ADMIN' && req.user.role !== 'PLATFORM_ADMIN') {
        const error = new Error('Only a platform administrator can change an organization administrator.')
        error.statusCode = 403
        throw error
      }
      const membership = previous
        ? await tx.organizationMembership.update({
            where: { id: previous.id },
            data: { role: req.body.role, status: 'ACTIVE' }
          })
        : await tx.organizationMembership.create({
            data: { organizationId, userId: targetUser.id, role: req.body.role, status: 'ACTIVE' }
          })
      if (req.body.facilityId) {
        const previousGrant = await tx.facilityAccess.findUnique({
          where: { membershipId_facilityId: { membershipId: membership.id, facilityId: req.body.facilityId } }
        })
        const grant = await tx.facilityAccess.upsert({
          where: { membershipId_facilityId: { membershipId: membership.id, facilityId: req.body.facilityId } },
          create: { membershipId: membership.id, facilityId: req.body.facilityId, role: req.body.role },
          update: { role: req.body.role }
        })
        await tx.auditEvent.create({
          data: {
            organizationId,
            facilityId: req.body.facilityId,
            actorUserId: req.user.id,
            action: previousGrant ? 'FACILITY_ACCESS_CHANGED' : 'FACILITY_ACCESS_GRANTED',
            resourceType: 'FacilityAccess',
            resourceId: grant.id,
            reason: req.body.reason,
            beforeState: previousGrant ? { role: previousGrant.role } : undefined,
            afterState: { membershipId: membership.id, userId: targetUser.id, role: req.body.role }
          }
        })
      }
      await tx.auditEvent.create({
        data: {
          organizationId,
          facilityId: req.body.facilityId,
          actorUserId: req.user.id,
          action: previous ? 'MEMBERSHIP_CHANGED' : 'MEMBERSHIP_CREATED',
          resourceType: 'OrganizationMembership',
          resourceId: membership.id,
          reason: req.body.reason,
          beforeState: previous ? { role: previous.role, status: previous.status } : undefined,
          afterState: { userId: targetUser.id, role: membership.role, status: membership.status, facilityId: req.body.facilityId || null }
        }
      })
      return membership
    }, { isolationLevel: 'Serializable' })
    res.status(201).json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

router.post('/organizations/:organizationId/memberships/:membershipId/suspend', authMiddleware, validateBody(suspendSchema), async (req, res, next) => {
  try {
    const organizationId = req.params.organizationId
    const membership = await prisma.$transaction(async (tx) => {
      const canManage = req.user.role === 'PLATFORM_ADMIN' || await requireOrganizationAdmin(tx, req.user.id, organizationId)
      if (!canManage) {
        const error = new Error('Organization not found.')
        error.statusCode = 404
        throw error
      }
      const existing = await tx.organizationMembership.findFirst({ where: { id: req.params.membershipId, organizationId } })
      if (!existing) {
        const error = new Error('Membership not found.')
        error.statusCode = 404
        throw error
      }
      if (existing.role === 'ORG_ADMIN' && req.user.role !== 'PLATFORM_ADMIN') {
        const error = new Error('Only a platform administrator can suspend an organization administrator.')
        error.statusCode = 403
        throw error
      }
      const updated = await tx.organizationMembership.update({ where: { id: existing.id }, data: { status: 'SUSPENDED' } })
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId: req.user.id,
          action: 'MEMBERSHIP_SUSPENDED',
          resourceType: 'OrganizationMembership',
          resourceId: existing.id,
          reason: req.body.reason,
          beforeState: { status: existing.status },
          afterState: { status: updated.status }
        }
      })
      return updated
    }, { isolationLevel: 'Serializable' })
    res.json({ success: true, data: membership })
  } catch (error) {
    next(error)
  }
})

export default router
