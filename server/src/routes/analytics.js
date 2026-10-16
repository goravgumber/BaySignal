import { Router } from 'express'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { hasFacilityAccess } from '../tenantAccess.js'

const router = Router()

async function unavailableUntilValidatedData(req, res, next) {
  try {
    if (!(await hasFacilityAccess(prisma, req.user, req.params.facilityId, 'analytics_read'))) {
      return res.status(404).json({ success: false, error: 'Facility not found.', code: 404 })
    }
    return res.status(501).json({
      success: false,
      error: 'This report is unavailable until its source data and calculation are validated.',
      code: 501
    })
  } catch (error) {
    return next(error)
  }
}

router.get('/occupancy/:facilityId', authMiddleware, unavailableUntilValidatedData)
router.get('/revenue/:facilityId', authMiddleware, unavailableUntilValidatedData)
router.get('/environmental/:facilityId', authMiddleware, unavailableUntilValidatedData)
router.get('/top-slots/:facilityId', authMiddleware, unavailableUntilValidatedData)
router.get('/dashboard/:facilityId', authMiddleware, unavailableUntilValidatedData)

export default router
