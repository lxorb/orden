import { servePage, type Env } from '../../sync-server/src/api'
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export async function servePassLink(env: Env, request: Request): Promise<Response> {
  if (!env.ASSETS) return new Response('Not found', { status: 404 })
  const page = await servePage(env.ASSETS, request, '/pass-link.html')
  const headers = new Headers(page.headers)
  headers.set('content-security-policy', POLICY)
  headers.set('x-frame-options', 'DENY')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('cache-control', 'no-store')
  headers.set('x-robots-tag', 'noindex')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers })
}
