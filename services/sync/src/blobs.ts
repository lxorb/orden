import { Hono } from 'hono'
import { now } from './crypto'
import { fits } from './storage'
import type { Env, Variables } from './types'

/** Two megabytes of picture is already more than a note needs, and the limit
 *  keeps one paste from eating a tenth of the quota. */
const MAX_BLOB = 16 * 1024 * 1024

const HASH = /^[a-f0-9]{64}$/
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

const key = (hash: string) => `blobs/${hash}`

/** Uploading and accounting. Behind the session, like everything else here. */
export const blobs = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The picture is named by its own contents, so an upload of something already
 *  stored is just a row saying this account keeps it too. */
blobs.put('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: 'that is not a hash' }, 400)

  const type = context.req.header('content-type') ?? ''
  if (!TYPES.has(type)) return context.json({ error: 'images only' }, 415)

  // Read before the body is: a request that says it is bringing a hundred
  // megabytes is turned away without spending the memory to find out.
  const declared = Number(context.req.header('content-length') ?? 0)
  if (declared > MAX_BLOB) return context.json({ error: 'that image is too big' }, 413)

  const already = await context.env.DB.prepare(
    'select hash from blobs where hash = ? and user_id = ?',
  )
    .bind(hash, user.id)
    .first()

  if (already) return context.json({ hash, stored: false })

  const body = await context.req.arrayBuffer()
  if (!body.byteLength) return context.json({ error: 'nothing to store' }, 400)
  if (body.byteLength > MAX_BLOB) return context.json({ error: 'that image is too big' }, 413)

  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: 'out of space' }, 507)
  }

  // The object may already be there from someone else; writing it again is the
  // same bytes either way, and cheaper than asking first.
  await context.env.NOTES.put(key(hash), body, { httpMetadata: { contentType: type } })
  await context.env.DB.prepare(
    'insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)',
  )
    .bind(hash, user.id, body.byteLength, type, now())
    .run()

  return context.json({ hash, stored: true }, 201)
})

/** Gives a picture back and stops keeping it. The object survives while any
 *  other account still references it. */
blobs.delete('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  // Checked as it is on the way in, so a name that could never have been
  // stored cannot become a delete against the bucket.
  if (!HASH.test(hash)) return context.json({ error: 'that is not a hash' }, 400)

  await context.env.DB.prepare('delete from blobs where hash = ? and user_id = ?')
    .bind(hash, user.id)
    .run()

  const others = await context.env.DB.prepare('select 1 from blobs where hash = ? limit 1')
    .bind(hash)
    .first()

  if (!others) await context.env.NOTES.delete(key(hash))
  return context.json({ ok: true })
})

/** Serving, which carries no session: a note is read by whoever it was shared
 *  with, and a published blog has no reader to authenticate. The hash is the
 *  capability - it cannot be guessed, and it is all the note reveals. */
export const publicBlobs = new Hono<{ Bindings: Env }>()

publicBlobs.get('/:name', async (context) => {
  // The name carries an extension so that saving the image keeps a sensible
  // filename; only the hash in front of it decides what is served.
  const hash = context.req.param('name').split('.')[0]?.toLowerCase() ?? ''
  if (!HASH.test(hash)) return context.notFound()

  const object = await context.env.NOTES.get(key(hash))
  if (!object) return context.notFound()

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // Addressed by content, so it can never go stale.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${hash}"`,
    },
  })
})
