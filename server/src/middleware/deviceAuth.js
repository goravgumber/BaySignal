import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

export function verifyDeviceIngestion(req, res, next) {
  if (!config.deviceApiKey) {
    if (config.nodeEnv === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Device ingestion key is not configured.',
        code: 503
      })
    }
    return next()
  }

  const suppliedKey = req.header('x-device-key')
  if (!suppliedKey) {
    return res.status(401).json({ success: false, error: 'Invalid device API key.', code: 401 })
  }

  const suppliedBytes = Buffer.from(suppliedKey)
  const expectedBytes = Buffer.from(config.deviceApiKey)
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return res.status(401).json({ success: false, error: 'Invalid device API key.', code: 401 })
  }
  return next()
}
