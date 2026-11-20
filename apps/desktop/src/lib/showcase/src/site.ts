import { APP_ORIGIN } from './links'

interface Assets {
  fetch(request: Request): Promise<Response>
}
const UNFRAMED: Record<string, string> = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}
const KEPT = '/home/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n'
export function siteFiles(): Record<string, string> {
  return { _headers: KEPT }
}
export async function siteAnswer(request: Request, assets: Assets): Promise<Response> {
  const url = new URL(request.url)
  const reading = request.method === 'GET' || request.method === 'HEAD'
  if (url.pathname !== '/' || url.search !== '' || !reading) {
    const to = new URL(url.pathname + url.search, APP_ORIGIN)
    return new Response(null, { status: reading ? 301 : 308, headers: { location: to.href } })
  }
  const page = await assets.fetch(request)
  const headers = new Headers(page.headers)
  for (const [name, value] of Object.entries(UNFRAMED)) headers.set(name, value)
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers })
}
