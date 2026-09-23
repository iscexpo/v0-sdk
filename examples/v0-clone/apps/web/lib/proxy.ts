/**
 * v0-clone has no user accounts: every visitor shares the deployer's v0
 * workspace, API quota, and Vercel team resources. This same-origin check is
 * only a baseline against browser cross-origin abuse — it does not stop direct
 * non-browser requests. Replace or extend it with your application's session
 * auth before exposing a deployment to untrusted users, and keep Vercel
 * deployment protection enabled until then.
 */
const MAX_JSON_BODY_BYTES = 64 * 1024
const MAX_MESSAGE_LENGTH = 12_000

export function authorizeProxyRequest(request: Request): Response | undefined {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ message: 'Forbidden' }, { status: 403 })
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    return Response.json({ message: 'Request body is too large.' }, { status: 413 })
  }
}

export function isValidMessage(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_MESSAGE_LENGTH
}
