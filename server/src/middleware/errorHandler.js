import crypto from 'crypto'

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route not found.',
    code: 404
  })
}

export function errorHandler(error, req, res, next) {
  const requestId = crypto.randomUUID()
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
  console.error('request_error', JSON.stringify({
    requestId,
    statusCode,
    method: req.method,
    route: req.route?.path || 'unmatched',
    errorName: error?.name || 'Error',
    errorCode: typeof error?.code === 'string' ? error.code : undefined
  }))

  const safeMessage = statusCode >= 500 ? 'Internal Server Error' : error.message || 'Request failed'
  res.status(statusCode).json({
    success: false,
    error: safeMessage,
    code: statusCode,
    requestId
  })
}
