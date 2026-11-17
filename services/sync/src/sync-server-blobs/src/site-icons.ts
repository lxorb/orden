import { Hono } from 'hono'
import {
  bytesAtMost,
  type Env,
  NOT_AN_OBJECT,
  objectBody,
  privateHost,
  type Variables,
} from '../../sync-server/src/api'

export const MOST_SITES = 300

const MOST_PICTURE_BYTES = 64 * 1024

const SITE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const LONGEST_LABEL = 120

const LONGEST_SOURCE = 2048

const TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
])

const DATA = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is

export const siteIcons = new Hono<{ Bindings: Env; Variables: Variables }>()

interface Row {
  site: string
  label: string
  seen: number
  hash: string | null
}

siteIcons.get('/', async (context) => {
  const user = context.get('user')
  const { results } = await context.env.DB.prepare(
    'select site, label, seen, hash from site_icons where user_id = ? order by seen desc limit ?',
  )
    .bind(user.id, MOST_SITES)
    .all<Row>()

  return context.json({ sites: results })
})

siteIcons.get('/:site/picture', async (context) => {
  const user = context.get('user')
  const site = context.req.param('site')
  const row = await context.env.DB.prepare(
    'select type, hash, picture from site_icons where user_id = ? and site = ?',
  )
    .bind(user.id, site)
    .first<{ type: string | null; hash: string | null; picture: ArrayBuffer | number[] | null }>()

  if (!row?.picture || !row.type) return context.json({ error: 'no such picture' }, 404)

  return new Response(new Uint8Array(row.picture), {
    headers: {
      'content-type': row.type,
      etag: `"${row.hash ?? ''}"`,
      'cache-control': 'private, max-age=0',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
})

siteIcons.post('/', async (context) => {
  const user = context.get('user')
  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const site = siteOf(body.site)
  if (!site) return context.json({ error: 'that is not a site' }, 400)

  const now = Date.now()
  const seen = typeof body.seen === 'number' && Number.isFinite(body.seen) ? body.seen : now
  const label = typeof body.label === 'string' ? labelOf(body.label) : ''
  const source =
    typeof body.icon === 'string' && body.icon.length <= MOST_PICTURE_BYTES * 2 ? body.icon : null

  const held = await context.env.DB.prepare(
    'select source from site_icons where user_id = ? and site = ?',
  )
    .bind(user.id, site)
    .first<{ source: string | null }>()

  const remembered = source === null ? null : sourceKey(source)
  const picture =
    remembered !== null && remembered !== held?.source ? await pictureFrom(source ?? '') : null

  await context.env.DB.prepare(
    `insert into site_icons (user_id, site, label, seen, source, hash, type, picture)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     on conflict (user_id, site) do update set
       label = case when excluded.label <> '' then excluded.label else site_icons.label end,
       seen = max(site_icons.seen, excluded.seen),
       source = coalesce(excluded.source, site_icons.source),
       hash = coalesce(excluded.hash, site_icons.hash),
       type = coalesce(excluded.type, site_icons.type),
       picture = coalesce(excluded.picture, site_icons.picture)`,
  )
    .bind(
      user.id,
      site,
      label,
      Math.min(seen, now),
      picture ? remembered : null,
      picture?.hash ?? null,
      picture?.type ?? null,
      picture?.bytes ?? null,
    )
    .run()

  await context.env.DB.prepare(
    `delete from site_icons where user_id = ?1 and site not in
       (select site from site_icons where user_id = ?1 order by seen desc limit ?2)`,
  )
    .bind(user.id, MOST_SITES)
    .run()

  const row = await context.env.DB.prepare(
    'select site, label, seen, hash from site_icons where user_id = ? and site = ?',
  )
    .bind(user.id, site)
    .first<Row>()

  return context.json({ site: row })
})

siteIcons.delete('/', async (context) => {
  const user = context.get('user')
  const body = (await objectBody(context)) ?? {}

  if (Array.isArray(body.sites)) {
    const sites = body.sites.map(siteOf).filter((one): one is string => one !== null)
    for (const site of sites) {
      await context.env.DB.prepare('delete from site_icons where user_id = ? and site = ?')
        .bind(user.id, site)
        .run()
    }
    return context.json({ ok: true })
  }

  const since = typeof body.since === 'number' && Number.isFinite(body.since) ? body.since : 0
  await context.env.DB.prepare('delete from site_icons where user_id = ? and seen >= ?')
    .bind(user.id, since)
    .run()
  return context.json({ ok: true })
})

export function siteOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const site = value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
  return SITE.test(site) && !privateHost(site) ? site : null
}

function labelOf(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, LONGEST_LABEL)
}

function sourceKey(source: string): string | null {
  if (DATA.test(source)) return `data:${source.length}:${quickHash(source)}`
  return source.length <= LONGEST_SOURCE ? source : null
}

function quickHash(text: string): string {
  let one = 0x811c9dc5
  for (let at = 0; at < text.length; at++) one = Math.imul(one ^ text.charCodeAt(at), 16777619)
  return (one >>> 0).toString(36)
}

interface Picture {
  bytes: Uint8Array
  type: string
  hash: string
}

async function pictureFrom(source: string): Promise<Picture | null> {
  const inline = DATA.exec(source)
  if (inline) {
    const type = (inline[1] ?? '').toLowerCase()
    if (!TYPES.has(type)) return null
    const bytes = inline[2] ? fromBase64(inline[3] ?? '') : fromText(inline[3] ?? '')
    return bytes && bytes.length <= MOST_PICTURE_BYTES ? await withHash(bytes, type) : null
  }

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || privateHost(url.hostname)) return null

  try {
    const response = await fetch(url.href, {
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (!type || !TYPES.has(type)) return null

    const bytes = await bytesAtMost(response, MOST_PICTURE_BYTES)
    return bytes && bytes.length > 0 ? await withHash(bytes, type) : null
  } catch {
    return null
  }
}

async function withHash(bytes: Uint8Array, type: string): Promise<Picture> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = [...digest].map((one) => one.toString(16).padStart(2, '0')).join('')
  return { bytes, type, hash }
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const plain = atob(text.replace(/\s+/g, ''))
    return Uint8Array.from(plain, (one) => one.charCodeAt(0))
  } catch {
    return null
  }
}

function fromText(text: string): Uint8Array | null {
  try {
    return new TextEncoder().encode(decodeURIComponent(text))
  } catch {
    return null
  }
}
