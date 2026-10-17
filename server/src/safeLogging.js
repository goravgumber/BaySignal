export function logProcessError(event, error) {
  console.error(event, JSON.stringify({
    errorName: error?.name || 'Error',
    errorCode: typeof error?.code === 'string' ? error.code : undefined
  }))
}
