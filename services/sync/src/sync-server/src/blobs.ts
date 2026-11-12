import { DIAGRAM_SCHEMES, diagramKey } from '@orden/markdown/diagrams'
import { Hono } from 'hono'
import { NOT_A_HASH, OUT_OF_SPACE } from './refused'
import { hooks } from './hooks'
import { spaceForHost } from './site/host'
import { readSite, SVG_POLICY } from './site/site'
import { now } from './crypto'
import { readSpaceFiles } from './spaces/files'
import { allows, reachedSpace } from './spaces/space'
import {
  BYTES,
  hashOfBytes,
  held,
  holdsItsName,
  spellsADiagramName,
  WRONG_BYTES,
} from './sync2/files'
import { fits, fitsSql } from './storage'
import type { Env, Space, Variables, Whoever } from './types'
import { handedTo, ownOtherwise, type Reading, reading, unreadUses, usedElsewhere } from './used'
import { said } from './said'

const LIMITS: Record<string, number> = {
  'image/png': 16 * 1024 * 1024,
  'image/jpeg': 16 * 1024 * 1024,
  'image/gif': 16 * 1024 * 1024,
  'image/webp': 16 * 1024 * 1024,
  'image/avif': 16 * 1024 * 1024,
  'application/pdf': 64 * 1024 * 1024,
  'text/css': 512 * 1024,
  'text/javascript': 512 * 1024,
  'image/svg+xml': 512 * 1024,
}

const DOCUMENTS = new Set(['application/pdf'])

const HASH = /^[a-f0-9]{64}$/

const STILL_READING = 'that file may still be in a note - try again tomorrow'

function typeOf(header: string): string {
  return (header.split(';')[0] ?? '').trim().toLowerCase()
}

const key = (hash: string) => `blobs/${hash}`

export const blobs = new Hono<{ Bindings: Env; Variables: Variables }>()

blobs.put('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)

  const type = typeOf(context.req.header('content-type') ?? '')
  const limit = LIMITS[type]
  if (limit === undefined) {
    return context.json({ error: 'images, PDFs and a site’s own css or js only' }, 415)
  }

  const declared = Number(context.req.header('content-length') ?? 0)
  if (declared > limit) return context.json({ error: 'that file is too big' }, 413)

  const { mine, there } = await held(context.env, user.id, hash)
  if (mine) return context.json({ hash, stored: false })

  const body = await context.req.arrayBuffer()
  if (!body.byteLength) return context.json({ error: 'nothing to store' }, 400)
  if (body.byteLength > limit) return context.json({ error: 'that file is too big' }, 413)

  const verified = (await hashOfBytes(body)) === hash && !spellsADiagramName(body)
  if (!verified && type !== 'image/svg+xml') return context.json({ error: WRONG_BYTES }, 400)
  const drawn = said((name) => context.req.header(name), 'diagram')
  if (
    !verified &&
    drawn !== undefined &&
    !(await drawnFrom(context.env, context.get('who'), hash, drawn))
  ) {
    return context.json({ error: WRONG_BYTES }, 400)
  }
  if (!verified && there) return context.json({ error: WRONG_BYTES }, 400)

  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  if (!there || (verified && !(await holdsItsName(context.env, hash, body.byteLength)))) {
    await context.env.NOTES.put(key(hash), body, { httpMetadata: { contentType: type } })
  }
  const written = await context.env.DB.prepare(
    `insert into blobs (hash, user_id, size, type, created_at)
     select ?1, ?2, ?3, ?4, ?5 where ${fitsSql('?2', '?3')}
     on conflict(hash, user_id) do nothing`,
  )
    .bind(hash, user.id, body.byteLength, type, now())
    .run()
  if (!written.meta.changes) {
    const after = await held(context.env, user.id, hash)
    if (!after.mine) {
      if (!after.there) await context.env.NOTES.delete(key(hash))
      return context.json({ error: OUT_OF_SPACE }, 507)
    }
  }

  return context.json({ hash, stored: true }, 201)
})

async function drawnFrom(env: Env, who: Whoever, hash: string, said: string): Promise<boolean> {
  const preimage = new URLSearchParams(said)
  const spaceId = preimage.get('space')
  const language = preimage.get('language')
  const code = preimage.get('code')
  const scheme = DIAGRAM_SCHEMES.find((one) => one === preimage.get('scheme'))
  if (spaceId === null || language === null || code === null || scheme === undefined) return false
  if ((await diagramKey(spaceId, language, code, scheme)) !== hash) return false

  const space = await reachedSpace(env, who, spaceId)
  return space !== null && allows(space.role, 'write')
}

blobs.delete('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)

  if (!(await letGo(context.env, user.id, hash))) {
    return context.json({ error: STILL_READING }, 409)
  }
  return context.json({ ok: true })
})

export async function letGo(
  env: Env,
  userId: string,
  hash: string,
  own = false,
  done: Reading = reading(),
): Promise<boolean> {
  const owed = await usedElsewhere(env, userId, new Set([hash]), own)
  if (owed.has(userId)) return true

  const mine = await env.DB.prepare(
    'select u.email, b.type from blobs b join users u on u.id = b.user_id where b.hash = ? and b.user_id = ?',
  )
    .bind(hash, userId)
    .first<{ email: string; type: string }>()
  const picture = mine?.type.startsWith('image/') ?? false

  if (own) {
    const otherwise = await ownOtherwise(env, userId, hash, picture, done)
    if (otherwise === 'used') return true
    if (otherwise === 'unknown') return false
  }

  if (mine && picture) {
    const user = { id: userId, email: mine.email }
    if (!(await unreadUses(env, user, new Set([hash]), owed, false, done))) return false
  }

  await env.DB.batch([
    ...handedTo(env, userId, owed, now()),
    env.DB.prepare('delete from blobs where hash = ? and user_id = ?').bind(hash, userId),
  ])

  const others = await env.DB.prepare('select 1 from blobs where hash = ? limit 1')
    .bind(hash)
    .first()
  if (!others) await env.NOTES.delete(key(hash))
  return true
}

export const publicBlobs = new Hono<{ Bindings: Env }>()

const DRESSING = new Set(['text/css', 'text/javascript'])

async function dressesThisSite(env: Env, host: string, hash: string): Promise<boolean> {
  const space = await spaceForHost(env, host)
  if (!space) return false

  const site = readSite(space.site)
  if (site.theme?.hash === hash) return true

  return readSpaceFiles(space.files).some((one) => one.hash === hash)
}

async function publishedAnywhere(env: Env, hash: string, request: Request): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `select * from spaces
      where blog_enabled = 1 and deleted = 0 and files like ?1 limit 50`,
  )
    .bind(`%${hash}%`)
    .all<Space>()

  for (const space of results) {
    for (const file of readSpaceFiles(space.files)) {
      if (file.hash === hash && (await hooks().blog.publishesFile(env, space, file, request)))
        return true
    }
  }
  return false
}

publicBlobs.get('/:name', async (context) => {
  const hash = context.req.param('name').split('.')[0]?.toLowerCase() ?? ''
  if (!HASH.test(hash)) return context.notFound()

  const object = await context.env.NOTES.get(key(hash))
  if (!object) return context.notFound()

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream'

  if (type === BYTES) return context.notFound()
  if (DOCUMENTS.has(type) && !(await publishedAnywhere(context.env, hash, context.req.raw))) {
    return context.notFound()
  }

  if (DRESSING.has(type)) {
    const host = new URL(context.req.url).host
    if (!(await dressesThisSite(context.env, host, hash))) return context.notFound()
  }

  return new Response(object.body, {
    headers: {
      'content-type': type,
      'cache-control': DOCUMENTS.has(type)
        ? 'private, no-cache'
        : 'public, max-age=31536000, immutable',
      etag: `"${hash}"`,
      'x-content-type-options': 'nosniff',
      ...(type === 'image/svg+xml' ? { 'content-security-policy': SVG_POLICY } : {}),
    },
  })
})
