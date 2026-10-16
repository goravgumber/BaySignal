export function validateSeedEnvironment(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Demo seeding is disabled in production.')
  }
  if (env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_DEMO_SEED=true to opt in to creating demo records.')
  }
  if (typeof env.SEED_DEMO_PASSWORD !== 'string' || env.SEED_DEMO_PASSWORD.length < 12) {
    throw new Error('SEED_DEMO_PASSWORD must be explicitly configured with at least 12 characters.')
  }
  return env.SEED_DEMO_PASSWORD
}
