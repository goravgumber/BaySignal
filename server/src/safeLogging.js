export function logProcessError(event, error) {
  console.error(event, JSON.stringify({
    errorName: error?.name || 'Error',
    errorCode: typeof error?.code === 'string' ? error.code : undefined
  }))
}

const SENSITIVE_KEY_PATTERN = /secret|token|password|auth|key|signature|body|rawBody|hash|digest|private/i

function sanitizeMetadata(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Error) {
    return { errorName: value.name || 'Error', errorCode: typeof value.code === 'string' ? value.code : undefined }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1))
  }
  if (typeof value === 'object') {
    const sanitized = {}
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        sanitized[k] = '[REDACTED]'
      } else {
        sanitized[k] = sanitizeMetadata(v, depth + 1)
      }
    }
    return sanitized
  }
  return undefined
}

export function logDiagnostic(event, details = {}) {
  const safe = sanitizeMetadata(details) || {}
  const isWarning = /rejected|failed|denied|timeout|conflict|stale|error/i.test(event)
  const logFn = isWarning ? console.warn : console.info
  logFn(event, JSON.stringify(safe))
}
