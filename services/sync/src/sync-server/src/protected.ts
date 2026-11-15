import { Hono } from 'hono'
import { tryDecodeURIComponent } from 'hono/utils/url'
import { objectBody, objectIn } from './body'
import { byteLength } from './crypto'
import { NOT_AN_OBJECT } from './refused'
import { LONGEST_PATH, staysInside } from './spaces/paths'
import type { Env, Variables } from './types'

type Way = 'password' | 'device'

interface Password {
  n: number
  r: number
  p: number
  salt: string
  hash: string
  at: number
}

interface Protected {
  password: Password | null
  spaces: Record<string, Record<string, Way>>
}

const MOST_PER_SPACE = 400
const MOST_SPACES = 200
const MOST_BYTES = 64 * 1024
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/
const BASE64 = /^[A-Za-z0-9+/=]{4,128}$/

const isWay = (value: unknown): value is Way => value === 'password' || value === 'device'

const whole = (value: unknown, most: number): value is number =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= most

function passwordOf(value: unknown): Password | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { n, r, p, salt, hash, at } = value as Record<string, unknown>
  if (!whole(n, 1 << 20) || (n & (n - 1)) !== 0 || !whole(r, 32) || !whole(p, 16)) return null
  if (typeof salt !== 'string' || !BASE64.test(salt)) return null
  if (typeof hash !== 'string' || !BASE64.test(hash)) return null
  if (!whole(at, Number.MAX_SAFE_INTEGER)) return null
  return { n, r, p, salt, hash, at }
}

function waysOf(value: unknown): Record<string, Way> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, Way> = {}
  for (const [key, way] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MOST_PER_SPACE) break
    const path = key === '' || (key.length <= LONGEST_PATH && staysInside(key))
    if (path && isWay(way)) out[key] = way
  }
  return out
}

function readProtected(raw: string | null | undefined): Protected {
  const held = objectIn(raw) ?? {}
  const spaces: Record<string, Record<string, Way>> = {}
  const listed = held.spaces
  const entries =
    listed && typeof listed === 'object' && !Array.isArray(listed) ? Object.entries(listed) : []
  for (const [id, ways] of entries) {
    if (Object.keys(spaces).length >= MOST_SPACES) break
    const kept = waysOf(ways)
    if (SPACE_ID.test(id) && Object.keys(kept).length) spaces[id] = kept
  }
  return { password: passwordOf(held.password), spaces }
}

async function rawFor(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('select protected from users where id = ?')
    .bind(userId)
    .first<{ protected: string | null }>()
  return row?.protected ?? null
}

async function protectedFor(env: Env, userId: string): Promise<Protected> {
  return readProtected(await rawFor(env, userId))
}

function folded(path: string): string {
  let out = ''
  for (const one of path.normalize('NFC')) {
    const upper = one.toUpperCase()
    const lower = upper.toLowerCase()
    out += Array.from(upper).length !== 1 ? one : Array.from(lower).length === 1 ? lower : upper
  }
  return out
}

function covers(ways: Record<string, Way> | undefined, path: string): boolean {
  if (!ways) return false
  const asked = folded(path)
  return Object.keys(ways).some((key) => {
    const kept = folded(key)
    return kept === '' || asked === kept || asked.startsWith(`${kept}/`)
  })
}

export type Shut = (spaceId: string, path: string) => boolean

export const PROTECTED = (path: string) =>
  `${path} is protected. The reader can open it in Orden; an agent cannot.`

const SPACE_ROUTE = /^\/v[12]\/spaces\/([^/]+)\/(?:changes|notes|rollback|feed)$/

const NOTE_ROUTE = /^\/v1\/notes\/([^/]+)(?:\/|$)/

const routed = (segment: string | undefined) =>
  segment === undefined ? undefined : tryDecodeURIComponent(segment)

const KEPT_FROM_TOKENS = 'This space keeps notes from agents, so a token cannot reach it.'

export async function keptFromProgram(
  env: Env,
  userId: string,
  method: string,
  path: string,
): Promise<string | null> {
  const { spaces } = await protectedFor(env, userId)
  if (!Object.keys(spaces).length) return null
  if (path === '/v2/docs/pull') return KEPT_FROM_TOKENS

  const space = routed(SPACE_ROUTE.exec(path)?.[1])
  if (space !== undefined) return spaces[space] ? KEPT_FROM_TOKENS : null

  const id = routed(NOTE_ROUTE.exec(path)?.[1])
  if (id === undefined) return null
  const note = await env.DB.prepare('select space_id, path from notes where id = ?')
    .bind(id)
    .first<{ space_id: string; path: string }>()
  const ways = note ? spaces[note.space_id] : undefined
  if (!note || !ways) return null
  if (method !== 'GET') return KEPT_FROM_TOKENS
  return covers(ways, note.path) ? PROTECTED(note.path) : null
}

export async function shutFor(env: Env, userId: string): Promise<Shut> {
  const held = await protectedFor(env, userId)
  return (spaceId, path) => covers(held.spaces[spaceId], path)
}

const TOO_MUCH = 'that is more than an account protects'

const TOO_MANY_SPACES = `at most ${MOST_SPACES} spaces hold something protected`

const BUSY = 'what is protected changed meanwhile, try again'

const TRIES = 8

interface Refusal {
  error: string
  status: 413 | 503
}

async function rewrite(
  env: Env,
  userId: string,
  change: (held: Protected) => Protected | Refusal,
): Promise<Protected | Refusal> {
  for (let tried = 0; tried < TRIES; tried++) {
    const raw = await rawFor(env, userId)
    const next = change(readProtected(raw))
    if ('error' in next) return next
    const written = JSON.stringify(next)
    if (byteLength(written) > MOST_BYTES) return { error: TOO_MUCH, status: 413 }
    const done = await env.DB.prepare(
      'update users set protected = ?1 where id = ?2 and protected is ?3',
    )
      .bind(written, userId, raw)
      .run()
    if (done.meta.changes) return next
  }
  return { error: BUSY, status: 503 }
}

export async function protectLikewise(
  env: Env,
  userId: string,
  spaceId: string,
  pairs: readonly { from: string; to: string }[],
): Promise<number> {
  const wanted = (held: Protected) =>
    pairs.filter(({ from, to }) => {
      const ways = held.spaces[spaceId]
      return ways?.[from] !== undefined && !covers(ways, to)
    })
  if (!wanted(await protectedFor(env, userId)).length) return 0
  let added = 0
  const next = await rewrite(env, userId, (held) => {
    const adding = wanted(held)
    added = adding.length
    if (!adding.length) return held
    const ways = { ...held.spaces[spaceId] }
    for (const { from, to } of adding) {
      const way = ways[from]
      if (way && Object.keys(ways).length < MOST_PER_SPACE) ways[to] = way
    }
    return { ...held, spaces: { ...held.spaces, [spaceId]: ways } }
  })
  return 'error' in next ? 0 : added
}

export const protectedRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()

protectedRoutes.get('/', async (context) => {
  return context.json(await protectedFor(context.env, context.get('user').id))
})

protectedRoutes.put('/password', async (context) => {
  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)
  const sent = passwordOf(body.password)
  if (!sent) return context.json({ error: 'password must be a hash the app wrote' }, 400)

  const user = context.get('user').id
  const held = await protectedFor(context.env, user)
  if (held.password && held.password.at >= sent.at) return context.json(held)

  const next = await rewrite(context.env, user, (now) =>
    now.password && now.password.at >= sent.at ? now : { ...now, password: sent },
  )
  if ('error' in next) return context.json({ error: next.error }, next.status)
  return context.json(next)
})

protectedRoutes.put('/spaces/:id', async (context) => {
  const id = context.req.param('id')
  if (!SPACE_ID.test(id)) return context.json({ error: 'not a space' }, 400)
  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)
  if (!body.protected || typeof body.protected !== 'object' || Array.isArray(body.protected)) {
    return context.json({ error: 'protected must be an object' }, 400)
  }

  const ways = waysOf(body.protected)
  const next = await rewrite(context.env, context.get('user').id, (held) => {
    const spaces = Object.fromEntries(Object.entries(held.spaces).filter(([one]) => one !== id))
    if (Object.keys(ways).length) {
      if (Object.keys(spaces).length >= MOST_SPACES) return { error: TOO_MANY_SPACES, status: 413 }
      spaces[id] = ways
    }
    return { ...held, spaces }
  })
  if ('error' in next) return context.json({ error: next.error }, next.status)
  return context.json(next)
})
