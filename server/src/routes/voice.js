import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { authMiddleware } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
const querySchema = z.object({ text: z.string().trim().min(1).max(500) })
const voiceLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false })

router.post('/query', voiceLimiter, authMiddleware, validateBody(querySchema), (req, res) => {
  res.json({
    success: true,
    data: {
      intent: 'UNAVAILABLE',
      response: 'Voice answers for live facility data are unavailable until tenant-scoped data sources are configured.',
      data: {},
      language: 'en'
    }
  })
})

export default router
