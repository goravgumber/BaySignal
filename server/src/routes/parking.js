import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { getBayDisplayStatus, summarizeBayRecords } from '../reconcileBayState.js'
import { accessibleFacilityIds, hasFacilityAccess } from '../tenantAccess.js'

const router = Router()

const slotStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'])
})
const slotFilterSchema = z.object({
  zone: z.string().trim().max(16).optional(),
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED']).optional()
})

function buildFacilitySummaryFromSlots(slots) {
  return { ...summarizeBayRecords(slots), lastUpdated: new Date().toISOString() }
}

router.get('/facilities', authMiddleware, async (req, res, next) => {
  try {
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'operations_read')
    const facilities = await prisma.facility.findMany({
      where: { id: { in: facilityIds } },
      include: {
        zones: {
          include: {
            slots: {
              select: {
                status: true,
                reservations: {
                  where: {
                    status: { in: ['UPCOMING', 'ACTIVE'] },
                    startTime: { lte: new Date() },
                    endTime: { gt: new Date() }
                  },
                  select: { id: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    const data = facilities.map((facility) => {
      const slots = facility.zones.flatMap((zone) => zone.slots.map((slot) => ({
        status: slot.status,
        reservationHold: slot.reservations.length > 0
      })))
      const summary = buildFacilitySummaryFromSlots(slots)

      return {
        id: facility.id,
        name: facility.name,
        address: facility.address,
        totalSlots: facility.totalSlots,
        zoneCount: facility.zones.length,
        available: summary.available,
        occupied: summary.occupied,
        reserved: summary.reserved
      }
    })

    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

router.get('/facilities/:id', authMiddleware, async (req, res, next) => {
  try {
    if (!(await hasFacilityAccess(prisma, req.user, req.params.id, 'operations_read'))) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }
    const facility = await prisma.facility.findUnique({
      where: { id: req.params.id },
      include: {
        zones: {
          include: {
            slots: {
              select: {
                id: true,
                status: true,
                slotType: true,
                reservations: {
                  where: {
                    status: { in: ['UPCOMING', 'ACTIVE'] },
                    startTime: { lte: new Date() },
                    endTime: { gt: new Date() }
                  },
                  select: { id: true }
                }
              }
            }
          },
          orderBy: { name: 'asc' }
        }
      }
    })

    if (!facility) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    const zones = facility.zones.map((zone) => {
      const summary = summarizeBayRecords(zone.slots.map((slot) => ({ status: slot.status, reservationHold: slot.reservations.length > 0 })))

      return {
        id: zone.id,
        name: zone.name,
        code: zone.code,
        capacity: zone.capacity,
        ratePerHour: zone.ratePerHour,
        ...summary
      }
    })

    res.json({
      success: true,
      data: {
        id: facility.id,
        name: facility.name,
        address: facility.address,
        city: facility.city,
        totalSlots: facility.totalSlots,
        lat: facility.lat,
        lng: facility.lng,
        zones
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/facilities/:id/slots', authMiddleware, validateQuery(slotFilterSchema), async (req, res, next) => {
  try {
    const { zone, status } = req.query
    const facilityId = req.params.id
    if (!(await hasFacilityAccess(prisma, req.user, facilityId, 'operations_read'))) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    const where = {
      zone: {
        facilityId,
        ...(zone
          ? {
              OR: [
                { code: String(zone).toUpperCase() },
                { name: { contains: String(zone), mode: 'insensitive' } }
              ]
            }
          : {})
      },
      ...(status ? { status: String(status).toUpperCase() } : {})
    }

    const slots = await prisma.parkingSlot.findMany({
      where,
      include: {
        zone: {
          select: {
            id: true,
            name: true,
            code: true,
            ratePerHour: true,
            facility: {
              select: {
                id: true,
                name: true,
                address: true,
                city: true
              }
            }
          }
        },
        reservations: {
          where: {
            status: { in: ['UPCOMING', 'ACTIVE'] },
            startTime: { lte: new Date() },
            endTime: { gt: new Date() }
          },
          select: { id: true }
        }
      },
      orderBy: { slotCode: 'asc' }
    })

    res.json({
      success: true,
      data: slots.map(({ reservations, ...slot }) => {
        const reservationHold = reservations.length > 0
        return { ...slot, reservationHold, displayStatus: getBayDisplayStatus(slot.status, reservationHold) }
      })
    })
  } catch (error) {
    next(error)
  }
})

router.get('/slots/:id', authMiddleware, async (req, res, next) => {
  try {
    const slot = await prisma.parkingSlot.findUnique({
      where: { id: req.params.id },
      include: {
        zone: {
          include: {
            facility: true
          }
        }
      }
    })

    if (!slot) {
      const error = new Error('Parking slot not found.')
      error.statusCode = 404
      throw error
    }

    if (!(await hasFacilityAccess(prisma, req.user, slot.zone.facilityId, 'operations_read'))) {
      const error = new Error('Parking slot not found.')
      error.statusCode = 404
      throw error
    }

    res.json({ success: true, data: slot })
  } catch (error) {
    next(error)
  }
})

router.put('/slots/:id/status', authMiddleware, validateBody(slotStatusSchema), async (req, res, next) => {
  try {
    const slot = await prisma.parkingSlot.findUnique({
      where: { id: req.params.id },
      include: { zone: { select: { facilityId: true } } }
    })
    if (!slot || !(await hasFacilityAccess(prisma, req.user, slot.zone.facilityId, 'correction_write'))) {
      return res.status(404).json({ success: false, error: 'Parking slot not found.', code: 404 })
    }
    return res.status(501).json({
      success: false,
      error: 'Manual bay corrections must be submitted through a discrepancy resolution with a reason and audit record.',
      code: 501
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/summary/:facilityId', authMiddleware, async (req, res, next) => {
  try {
    const { facilityId } = req.params
    if (!(await hasFacilityAccess(prisma, req.user, facilityId, 'operations_read'))) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }
    const slots = await prisma.parkingSlot.findMany({
      where: {
        zone: {
          facilityId
        }
      },
      select: {
        status: true,
        reservations: {
          where: {
            status: { in: ['UPCOMING', 'ACTIVE'] },
            startTime: { lte: new Date() },
            endTime: { gt: new Date() }
          },
          select: { id: true }
        }
      }
    })

    if (slots.length === 0) {
      const facility = await prisma.facility.findUnique({ where: { id: facilityId } })
      if (!facility) {
        const error = new Error('Facility not found.')
        error.statusCode = 404
        throw error
      }
    }

    const data = buildFacilitySummaryFromSlots(slots.map((slot) => ({ status: slot.status, reservationHold: slot.reservations.length > 0 })))
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

export default router
