import { assetFor, DOWNLOAD_PATH, isDownloadPlatform, LATEST_RELEASE_API, releaseAssets, releaseTag } from './links'

export const DOWNLOAD_EVENT = 'site download'
export const CAPTURE = 'https://eu.i.posthog.com/batch/'
const ASKING = 2500
const CRAWLER =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-|httpclient|go-http-client|okhttp|java\//i
const BUTTONS = ['hero', 'footer'] as const
interface Counter {
  POSTHOG_KEY?: string | undefined
}
export interface Later {
  waitUntil(promise: Promise<unknown>): void
}
type Asked = RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } }
type Fetcher = (input: string, init?: Asked) => Promise<Response>
const AGAIN = 2000
export interface Seen {
  first(client: string): Promise<boolean>
}
interface Kept {
  match(key: string): Promise<Response | undefined>
  put(key: string, answer: Response): Promise<void>
}
export function seenIn(kept: Kept | null, now: () => number = Date.now): Seen {
  const recent = new Map<string, number>()
  return {
    async first(client) {
      const at = now()
      for (const [one, when] of recent) if (at - when >= AGAIN) recent.delete(one)
      if (recent.has(client)) return false
      recent.set(client, at)
      if (!kept) return true
      const key = `https://orden.so/download-seen/${client}`
      if (await kept.match(key)) return false
      await kept.put(key, new Response('', { headers: { 'cache-control': `max-age=${AGAIN / 1000}` } }))
      return true
    },
  }
}
let shared: Seen | null = null
function edgeSeen(): Seen {
  shared ??= seenIn((globalThis as { caches?: { default?: Kept } }).caches?.default ?? null)
  return shared
}
async function clientOf(request: Request): Promise<string | null> {
  const address = request.headers.get('cf-connecting-ip')
  if (!address) return null
  const day = new Date().toISOString().slice(0, 10)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`orden-site ${day} ${address}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
async function firstFrom(request: Request, seen: Seen): Promise<boolean> {
  try {
    const client = await clientOf(request)
    return client === null || (await seen.first(client))
  } catch {
    return true
  }
}
interface Release {
  tag: string | null
  body: unknown
}
export function isDownloadPath(pathname: string): boolean {
  return pathname === DOWNLOAD_PATH || pathname.startsWith(`${DOWNLOAD_PATH}/`)
}
export function counts(request: Pick<Request, 'method' | 'headers'>): boolean {
  if (request.method !== 'GET') return false
  const agent = request.headers.get('user-agent') ?? ''
  if (agent === '' || CRAWLER.test(agent)) return false
  const purpose = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''}`
  return !/prefetch|prerender/i.test(purpose)
}
async function latest(fetcher: Fetcher): Promise<Release> {
  try {
    const answer = await fetcher(LATEST_RELEASE_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'orden-site' },
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: AbortSignal.timeout(ASKING),
    })
    if (!answer.ok) return { tag: null, body: null }
    const body: unknown = await answer.json()
    return { tag: releaseTag(body), body }
  } catch {
    return { tag: null, body: null }
  }
}
function count(fetcher: Fetcher, key: string, properties: Record<string, unknown>): Promise<unknown> {
  const captured = {
    event: DOWNLOAD_EVENT,
    distinct_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    properties: { ...properties, $lib: 'orden-site', $process_person_profile: false, $geoip_disable: true },
  }
  return fetcher(CAPTURE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, batch: [captured] }),
  }).catch(() => undefined)
}
export async function downloadAnswer(
  request: Request,
  env: Counter,
  later: Later,
  fetcher: Fetcher = fetch,
  seen: Seen = edgeSeen(),
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  const url = new URL(request.url)
  const named = url.pathname.slice(DOWNLOAD_PATH.length + 1)
  const platform = isDownloadPlatform(named) ? named : null
  const release = await latest(fetcher)
  const target = assetFor(platform, releaseAssets(release.body))
  const from = url.searchParams.get('from')
  const key = env.POSTHOG_KEY
  if (key && counts(request))
    later.waitUntil(
      firstFrom(request, seen).then((first) =>
        first
          ? count(fetcher, key, {
              platform: platform ?? 'none',
              button: BUTTONS.find((one) => one === from) ?? 'other',
              release: release.tag ?? 'unknown',
            })
          : undefined,
      ),
    )
  return new Response(null, {
    status: 302,
    headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
}
