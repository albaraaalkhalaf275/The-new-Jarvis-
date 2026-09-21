import { NextResponse } from 'next/server'

const buckets = new Map<string, { count: number; resetAt: number }>()

export const LIMITS = {
  chat: { windowMs: 60_000, max: 20 },
  tool: { windowMs: 60_000, max: 30 }
} as const

export function getClientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')
  return (forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown').slice(0, 100)
}

export function rateLimit(key: string, limit: keyof typeof LIMITS) {
  const now = Date.now()
  const config = LIMITS[limit]
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 }
  }

  existing.count += 1
  const allowed = existing.count <= config.max
  return {
    allowed,
    remaining: Math.max(0, config.max - existing.count),
    retryAfter: Math.ceil((existing.resetAt - now) / 1000)
  }
}

export function validateRequestOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (!origin) return true

  try {
    const originUrl = new URL(origin)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (!host) return false
    return originUrl.protocol === 'https:' && originUrl.host === host
  } catch {
    return false
  }
}

export function rejectIfTooLarge(req: Request, maxBytes: number) {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > maxBytes) {
    return NextResponse.json({ error: 'Request is too large.' }, { status: 413 })
  }
  return null
}

export function securityResponseHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  )
  return response
}

export function secureJson(data: unknown, init?: ResponseInit) {
  return securityResponseHeaders(NextResponse.json(data, init))
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/api[_ -]?key|authorization|secret|token|password|cookie/i.test(message)) {
    return 'The request failed. Check the server logs for details.'
  }
  return message.slice(0, 500) || 'Request failed.'
}
