/** Which web build a browser is served: the release, or the edge of `unstable`.
 *
 *  The deploy puts both builds in the one assets directory (scripts/web-channels.sh).
 *  The release is at the root, as it always was. The unstable build's pages and the
 *  files of its `public/` are under `/_unstable/`, and its bundle sits beside the
 *  release's in `/assets/`: every name in there carries the hash of its bytes, so the
 *  two builds can share the folder, and the edge keeps serving it without the Worker.
 *  Only the pages differ, and the pages are what this chooses between.
 *
 *  A browser asks for the edge with a cookie, `__Host-orden-channel=unstable`, and is served
 *  the release without one. `?channel=unstable` and `?channel=stable` on any page of
 *  the app set and clear it and send the browser back to the same page without the
 *  parameter, which is the whole of the switch: Settings links there, and so can
 *  anyone with an address bar. The cookie is readable from the page on purpose,
 *  because the page is the one that shows which it is on.
 *
 *  `__Host-` because every published site is a name under the app's own root and may run
 *  a script of its own, which may set a cookie for the whole root (#473). A browser takes
 *  one with this prefix only from the hostname itself, and only over https; on plain
 *  http, which is a machine running this for itself, the cookie has the old name.
 *
 *  The unstable build talks to this Worker, which is the release's, exactly as the
 *  unstable desktop builds do. See #424. */

import { sameOriginPath } from './hosts'

/** The cookie, its value for the edge, and the parameter that sets it. */
const CHANNEL_COOKIE = '__Host-orden-channel'
/** The name before the prefix, which browsers on the edge hold for a year. Read only
 *  where the new one is not there, so anyone who has chosen since cannot be moved by one
 *  set for the root; a browser that has not chosen still can be, until this goes. */
const OLD_CHANNEL_COOKIE = 'orden-channel'
const UNSTABLE = 'unstable'
const STABLE = 'stable'
const PARAMETER = 'channel'

/** Where the deploy puts the unstable build's pages; nothing else knows this name. */
const UNSTABLE_ROOT = '/_unstable'

/** A year. The choice is the reader's until they change it. */
const KEPT_FOR = 60 * 60 * 24 * 365

type Channel = 'stable' | 'unstable'

interface Assets {
  fetch(request: Request): Promise<Response>
}

/** The channel a request asks for. Anything but the edge's own value is the release. */
function channelOf(request: Request): Channel {
  const cookies = request.headers.get('cookie') ?? ''
  const said = cookieIn(cookies, CHANNEL_COOKIE) ?? cookieIn(cookies, OLD_CHANNEL_COOKIE)
  return said === UNSTABLE ? 'unstable' : 'stable'
}

/** The first value of one cookie in a `cookie` header. */
function cookieIn(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return null
}

/** `?channel=` on a page: the cookie set or cleared, and the same page again without
 *  it. Null when the request does not ask, or asks for something there is not. */
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

  // The release is said rather than cleared: with nothing under the new name, a cookie
  // set for the root would be read next and put this browser back on the edge.
  const value = asked === 'unstable' ? UNSTABLE : STABLE
  headers.append(
    'set-cookie',
    `${CHANNEL_COOKIE}=${value}; Path=/; Max-Age=${KEPT_FOR}; SameSite=Lax; Secure`,
  )
  headers.append('set-cookie', `${OLD_CHANNEL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`)
  return new Response(null, { status: 302, headers })
}

/** Whether a path is inside the unstable build's folder. Those are reached through the
 *  cookie and never by their own address, which would load the edge at a route the app
 *  does not know. */
function isUnstablePath(pathname: string): boolean {
  return pathname === UNSTABLE_ROOT || pathname.startsWith(`${UNSTABLE_ROOT}/`)
}

/** A page of the app, or a file of its `public/`, from the build the request asks for.
 *
 *  The assets binding is configured without a not-found page of its own, because it
 *  could only ever name the release's: a path neither build has is answered here with
 *  the asking build's `index.html`, which is what lets the app route it. */
export async function serveApp(assets: Assets, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return assets.fetch(request)

  const url = new URL(request.url)
  if (isUnstablePath(url.pathname)) return new Response('Not found', { status: 404 })

  const root = channelOf(request) === 'unstable' ? UNSTABLE_ROOT : ''
  const found = await assets.fetch(at(request, root + url.pathname))
  if (found.status !== 404) return root ? outOf(root, found) : found

  const page = await assets.fetch(at(request, `${root}/`))
  // An edge that was not deployed alongside is no reason to serve nothing.
  if (root && page.status === 404) return assets.fetch(at(request, '/'))
  return root ? outOf(root, page) : page
}

/** One of the app's own pages by file name (`/even.html`), from the build the request
 *  asks for, falling back to the release's when the edge has none. */
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

/** The request again, for another path of the same origin. */
function at(request: Request, pathname: string): Request {
  const url = new URL(request.url)
  url.pathname = pathname
  return new Request(url, request)
}

/** A response from the unstable folder as the browser should see it: a redirect the
 *  binding made (`/_unstable/handoff.html` to `/_unstable/handoff`) points at the
 *  address the browser asked under, and the answer says it depends on the cookie. */
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
