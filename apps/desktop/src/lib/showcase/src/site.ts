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
export const PREVIEW_PATH = '/preview/'
const PREVIEW_APP = `${PREVIEW_PATH}app/`
const PREVIEWED: Record<string, string> = {
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cache-control': 'no-cache',
}
function shownInPreview(url: URL, html: boolean): boolean {
  if (!url.pathname.startsWith(PREVIEW_APP) || !html) return true
  if (url.pathname.startsWith(`${PREVIEW_APP}demo/`)) return true
  return url.pathname === PREVIEW_APP && url.searchParams.has('demo')
}
export async function previewAnswer(request: Request, assets: Assets): Promise<Response> {
  const url = new URL(request.url)
  const home = new URL(PREVIEW_PATH, url.origin).href
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  if (url.pathname === PREVIEW_PATH.slice(0, -1)) return Response.redirect(home, 301)
  if (!url.pathname.startsWith(PREVIEW_PATH)) return new Response('Not found', { status: 404 })
  const found = await assets.fetch(request)
  const html = found.headers.get('content-type')?.includes('text/html') ?? false
  if (!shownInPreview(url, html)) return Response.redirect(home, 302)
  const headers = new Headers(found.headers)
  for (const [name, value] of Object.entries(PREVIEWED)) headers.set(name, value)
  return new Response(found.body, { status: found.status, statusText: found.statusText, headers })
}
