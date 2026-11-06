import { sameOriginPath } from './hosts'

const CHANNEL_COOKIE = '__Host-orden-channel'
const OLD_CHANNEL_COOKIE = 'orden-channel'
const UNSTABLE = 'unstable'
const STABLE = 'stable'
const PARAMETER = 'channel'

const UNSTABLE_ROOT = '/_unstable'

const KEPT_FOR = 60 * 60 * 24 * 365

type Channel = 'stable' | 'unstable'

interface Assets {
  fetch(request: Request): Promise<Response>
}

function channelOf(request: Request): Channel {
  const cookies = request.headers.get('cookie') ?? ''
  const said = cookieIn(cookies, CHANNEL_COOKIE) ?? cookieIn(cookies, OLD_CHANNEL_COOKIE)
  return said === UNSTABLE ? 'unstable' : 'stable'
}

function cookieIn(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return null
}

export function switchChannel(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const url = new URL(request.url)
  const asked = url.searchParams.get(PARAMETER)
  if (asked !== 'stable' && asked !== 'unstable') return null

  url.searchParams.delete(PARAMETER)
  const headers = new Headers({
    location: sameOriginPath(url.pathname) + url.search,
    'cache-control': 'no-store',
  })

  if (url.protocol !== 'https:') {
    headers.append(
      'set-cookie',
      asked === 'unstable'
        ? `${OLD_CHANNEL_COOKIE}=${UNSTABLE}; Path=/; Max-Age=${KEPT_FOR}; SameSite=Lax`
        : `${OLD_CHANNEL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
    )
    return new Response(null, { status: 302, headers })
  }

  const value = asked === 'unstable' ? UNSTABLE : STABLE
  headers.append(
    'set-cookie',
    `${CHANNEL_COOKIE}=${value}; Path=/; Max-Age=${KEPT_FOR}; SameSite=Lax; Secure`,
  )
  headers.append('set-cookie', `${OLD_CHANNEL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`)
  return new Response(null, { status: 302, headers })
}

function isUnstablePath(pathname: string): boolean {
  return pathname === UNSTABLE_ROOT || pathname.startsWith(`${UNSTABLE_ROOT}/`)
}

export async function serveApp(assets: Assets, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return assets.fetch(request)

  const url = new URL(request.url)
  if (isUnstablePath(url.pathname)) return new Response('Not found', { status: 404 })

  const root = channelOf(request) === 'unstable' ? UNSTABLE_ROOT : ''
  const found = await assets.fetch(at(request, root + url.pathname))
  if (found.status !== 404) return root ? outOf(root, found) : found

  const page = await assets.fetch(at(request, `${root}/`))
  if (root && page.status === 404) return assets.fetch(at(request, '/'))
  return root ? outOf(root, page) : page
}

export async function servePage(assets: Assets, request: Request, file: string): Promise<Response> {
  const url = new URL(request.url)
  const ask = (path: string) => {
    url.pathname = path
    return assets.fetch(new Request(url, { headers: { accept: 'text/html' } }))
  }

  if (channelOf(request) === 'unstable') {
    const page = await ask(UNSTABLE_ROOT + file)
    if (page.status !== 404) return page
  }
  return ask(file)
}

function at(request: Request, pathname: string): Request {
  const url = new URL(request.url)
  url.pathname = pathname
  return new Request(url, request)
}

function outOf(root: string, response: Response): Response {
  const headers = new Headers(response.headers)
  headers.append('vary', 'cookie')

  const location = headers.get('location')
  if (location) {
    const to = new URL(location, 'https://x')
    if (to.pathname === root || to.pathname.startsWith(`${root}/`)) {
      const inside = to.pathname.slice(root.length) || '/'
      headers.set(
        'location',
        /^[a-z]+:/i.test(location)
          ? new URL(inside + to.search, location).href
          : inside + to.search,
      )
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
