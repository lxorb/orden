/** Which web build a browser is served: the release, or the edge of `unstable`.
 *
 *  The deploy puts both builds in the one assets directory (scripts/web-channels.sh).
 *  The release is at the root, as it always was. The unstable build's pages and the
 *  files of its `public/` are under `/_unstable/`, and its bundle sits beside the
 *  release's in `/assets/`: every name in there carries the hash of its bytes, so the
 *  two builds can share the folder, and the edge keeps serving it without the Worker.
 *  Only the pages differ, and the pages are what this chooses between.
 *
 *  A browser asks for the edge with a cookie, `orden-channel=unstable`, and is served
 *  the release without one. `?channel=unstable` and `?channel=stable` on any page of
 *  the app set and clear it and send the browser back to the same page without the
 *  parameter, which is the whole of the switch: Settings links there, and so can
 *  anyone with an address bar. The cookie is readable from the page on purpose,
 *  because the page is the one that shows which it is on.
 *
 *  The unstable build talks to this Worker, which is the release's, exactly as the
 *  unstable desktop builds do. See #424. */

/** The cookie, its value for the edge, and the parameter that sets it. */
const CHANNEL_COOKIE = 'orden-channel'
const UNSTABLE = 'unstable'
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
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() !== CHANNEL_COOKIE) continue
    return part.slice(at + 1).trim() === UNSTABLE ? 'unstable' : 'stable'
  }
  return 'stable'
}

/** `?channel=` on a page: the cookie set or cleared, and the same page again without
 *  it. Null when the request does not ask, or asks for something there is not. */
export function switchChannel(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const url = new URL(request.url)
  const asked = url.searchParams.get(PARAMETER)
  if (asked !== 'stable' && asked !== 'unstable') return null

  url.searchParams.delete(PARAMETER)
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  const cookie =
    asked === 'unstable'
      ? `${CHANNEL_COOKIE}=${UNSTABLE}; Path=/; Max-Age=${KEPT_FOR}; SameSite=Lax${secure}`
      : `${CHANNEL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`

  return new Response(null, {
    status: 302,
    headers: {
      location: url.pathname + url.search,
      'set-cookie': cookie,
      'cache-control': 'no-store',
    },
  })
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
