export function createConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 4000,
    jwtSecret: env.JWT_SECRET || '',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
    databaseUrl: env.DATABASE_URL || '',
    nodeEnv: env.NODE_ENV || 'development',
    frontendUrl: env.FRONTEND_URL || (env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    trustProxy: env.TRUST_PROXY === 'true',
    deviceApiKey: env.DEVICE_API_KEY || '',
    allowSimulation: env.ALLOW_SIMULATION === 'true',
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    rateLimitMax: Number(env.RATE_LIMIT_MAX) || 300,
    authRateLimitMax: Number(env.AUTH_RATE_LIMIT_MAX) || 20
  }
}

export function validateRuntimeConfig(runtimeConfig) {
  if (runtimeConfig.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.')
  }
  if (!runtimeConfig.databaseUrl) {
    throw new Error('DATABASE_URL must be configured.')
  }
  if (runtimeConfig.nodeEnv === 'production') {
    let frontendOrigin
    try {
      frontendOrigin = new URL(runtimeConfig.frontendUrl)
    } catch {
      throw new Error('FRONTEND_URL must be a valid HTTPS origin in production.')
    }
    if (frontendOrigin.protocol !== 'https:' || frontendOrigin.origin !== runtimeConfig.frontendUrl) {
      throw new Error('FRONTEND_URL must be a valid HTTPS origin in production.')
    }
    if (!runtimeConfig.deviceApiKey || runtimeConfig.deviceApiKey.length < 32) {
      throw new Error('DEVICE_API_KEY must be configured with at least 32 characters in production.')
    }
  }
  return runtimeConfig
}

export const config = createConfig()
