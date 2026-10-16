import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { authMiddleware } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { authRateLimit } from '../middleware/rateLimiter.js'
import { userAccessSummary } from '../tenantAccess.js'

const router = Router()

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(64)
})

const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(1).max(64)
})

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  )
}

router.post('/register', authRateLimit, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body

    const normalizedEmail = String(email).toLowerCase().trim()
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      const error = new Error('Email is already registered.')
      error.statusCode = 409
      throw error
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        role: 'DRIVER'
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    })

    const token = makeToken(user)
    const userWithAccess = { ...user, ...(await userAccessSummary(prisma, user)) }
    res.status(201).json({
      success: true,
      data: {
        token,
        user: userWithAccess
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/login', authRateLimit, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body

    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase().trim() }
    })

    if (!user) {
      const error = new Error('Invalid email or password.')
      error.statusCode = 401
      throw error
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      const error = new Error('Invalid email or password.')
      error.statusCode = 401
      throw error
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }
    Object.assign(safeUser, await userAccessSummary(prisma, safeUser))

    const token = makeToken(user)
    res.json({
      success: true,
      data: {
        token,
        user: safeUser
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    })

    if (!user) {
      const error = new Error('User not found.')
      error.statusCode = 404
      throw error
    }

    const userWithAccess = { ...user, ...(await userAccessSummary(prisma, user)) }
    res.json({
      success: true,
      data: userWithAccess
    })
  } catch (error) {
    next(error)
  }
})

export default router
