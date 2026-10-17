/** The reader's AI accounts, kept for every device of the account and readable on none
 *  but theirs (docs/ai.md, "Every device").
 *
 *  The account holds two kinds of ciphertext and no key. The vault is the accounts and
 *  their API keys, sealed on a device with a key only the account's devices have; each
 *  device that has that key holds it wrapped to its own public key. The shape is web
 *  logins' (docs/sync-v2.md 6.6), on routes rather than the hub, because a phone and a
 *  browser carry AI accounts too.
 *
 *  A new device is let in by the reader comparing six digits on two screens, and the
 *  digits are worked out so that nobody between the two - this service included - can
 *  choose a key that shows the same ones:
 *
 *  1. The new device registers a commitment, SHA-256(pub || its nonce), and nothing else.
 *  2. A device that has the vault key answers with a random nonce of its own.
 *  3. Only then does the new device reveal its public key and its nonce. They have to
 *     hash to the commitment, and the key has to hash to the device's id.
 *  4. Both screens show six digits of SHA-256(new pub || new nonce || answering nonce ||
 *     answering pub). A key swapped in had to be committed to before the answering nonce
 *     existed, so it shows the same digits one time in a million, and every try is a
 *     prompt the reader sees.
 *
 *  Who may change what is the vault key's, not the session's: the vault is created with
 *  a token derived from the key (`auth`, HKDF of the vault key), and the account keeps
 *  only that token's hash. Answering a device, wrapping the key to it, writing the vault,
 *  turning a device down and letting the vault go each send the token, so a stolen
 *  session alone can register a device and wait - and nothing more. Letting the vault go
 *  without it is for an account with no allowed device left, which is when nobody could
 *  send it.
 *
 *  Every change is said to the account's hub, which tells its devices to read again.
 *  A write names the revision it read, and one over a newer revision is refused, so a
 *  device merges and writes again rather than writing another's change away. */

import { type Context, Hono } from 'hono'
import { readBody } from '../body'
import { now } from '../crypto'
import { askHub } from '../hub/reach'
import type { Env, Variables } from '../types'
import { deviceIn } from '../versions'

type Vault = Context<{ Bindings: Env; Variables: Variables }>

/** The most devices an account keeps for its AI accounts. */
const MOST_DEVICES = 30

/** The most a sealed vault may be: hundreds of accounts and their keys. */
const MOST_VAULT = 512 * 1024

/** A device's id, a public key and a wrap: what a device makes, base64 or hex. */
const ID = /^[a-f0-9]{32}$/
const BASE64 = /^[A-Za-z0-9+/=_-]+$/

const NO_SUCH_DEVICE = 'no such device'
const STALE = 'stale'
const NOT_THE_KEY = 'not the vault key'

export const aiVault = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The account's devices, told to read the vault again; never the one that wrote. */
function told(env: Env, user: string, from: string): Promise<unknown> {
  return askHub(env, user, 'ai', { 'x-nib-from': from }).catch(() => null)
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const raw = atob(text)
    const bytes = new Uint8Array(raw.length)
    for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at)
    return bytes
  } catch {
    return null
  }
}

async function digest(...parts: Uint8Array<ArrayBuffer>[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    all.set(one, at)
    at += one.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all))
}

function hexOf(bytes: Uint8Array, length = bytes.length): string {
  return [...bytes.slice(0, length)].map((one) => one.toString(16).padStart(2, '0')).join('')
}

/** The hash the account keeps of a vault token. */
async function authHash(auth: string): Promise<string | null> {
  const bytes = BASE64.test(auth) ? bytesOf(auth) : null
  return bytes ? hexOf(await digest(bytes)) : null
}

/** Whether `auth` is the token of the vault the account holds, compared without an
 *  early way out. No vault, no token, or the wrong one is no. */
async function holdsTheKey(env: Env, user: string, auth: string | undefined): Promise<boolean> {
  if (!auth) return false
  const held = await env.DB.prepare('select auth_hash from ai_vaults where user_id = ?')
    .bind(user)
    .first<{ auth_hash: string }>()
  const sent = (await authHash(auth)) ?? ''
  const kept = held?.auth_hash ?? ''
  if (sent.length === 0 || sent.length !== kept.length) return false
  let differ = 0
  for (let at = 0; at < sent.length; at++) differ |= sent.charCodeAt(at) ^ kept.charCodeAt(at)
  return differ === 0
}

/** Whether any of the account's devices is allowed: has the key wrapped to it. */
async function anyAllowed(env: Env, user: string): Promise<boolean> {
  const found = await env.DB.prepare(
    'select 1 as one from ai_devices where user_id = ? and approved_at is not null limit 1',
  )
    .bind(user)
    .first()
  return found !== null
}

/** The token a body carries, for the routes a body is optional on. */
async function authIn(context: Vault): Promise<string | undefined> {
  const sent: unknown = await context.req.json().catch(() => null)
  if (typeof sent !== 'object' || sent === null) return undefined
  const auth = (sent as Record<string, unknown>).auth
  return typeof auth === 'string' && auth.length <= 100 ? auth : undefined
}

interface VaultRow {
  rev: number
  blob: string
}

interface DeviceRow {
  id: string
  name: string
  pub: string | null
  commitment: string
  nonce: string | null
  nonce_from: string | null
  revealed: string | null
  wrapped: string | null
  approved_at: number | null
}

/** Everything a device reads: the vault, the devices with where each stands in being let
 *  in, and the key wrapped to it. */
aiVault.get('/', async (context) => {
  const user = context.get('user').id
  const device = context.req.query('device') ?? ''
  const [vault, devices] = await Promise.all([
    context.env.DB.prepare('select rev, blob from ai_vaults where user_id = ?')
      .bind(user)
      .first<VaultRow>(),
    context.env.DB.prepare(
      `select id, name, pub, commitment, nonce, nonce_from, revealed, wrapped, approved_at
         from ai_devices where user_id = ? order by created_at`,
    )
      .bind(user)
      .all<DeviceRow>(),
  ])
  const mine = devices.results.find((one) => one.id === device) ?? null
  return context.json({
    rev: vault?.rev ?? 0,
    blob: vault?.blob ?? null,
    wrapped: mine?.wrapped ?? null,
    devices: devices.results.map((one) => ({
      id: one.id,
      name: one.name,
      pub: one.pub,
      commitment: one.commitment,
      nonce: one.nonce,
      nonceFrom: one.nonce_from,
      revealed: one.revealed,
      approved: one.approved_at !== null,
    })),
  })
})

/** A device saying it is here, with a commitment to the key it will reveal. An allowed
 *  device keeps everything but its name; one still waiting starts its asking over, so a
 *  device that restarted asks with a fresh nonce rather than one it no longer has. */
aiVault.post('/devices', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const id = body.text('id', 32) ?? ''
  const commitment = body.text('commitment', 100) ?? ''
  const name = deviceIn(body.text('name', 200) ?? '') || 'Device'
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!ID.test(id) || !BASE64.test(commitment)) {
    return context.json({ error: 'not a device' }, 400)
  }

  const count = await context.env.DB.prepare(
    'select count(*) as n from ai_devices where user_id = ? and id != ?',
  )
    .bind(user, id)
    .first<{ n: number }>()
  if ((count?.n ?? 0) >= MOST_DEVICES) return context.json({ error: 'too many devices' }, 409)

  await context.env.DB.prepare(
    `insert into ai_devices (user_id, id, name, commitment, created_at) values (?1, ?2, ?3, ?4, ?5)
     on conflict(user_id, id) do update set
       name = excluded.name,
       commitment = case when ai_devices.approved_at is null
         then excluded.commitment else ai_devices.commitment end,
       nonce = case when ai_devices.approved_at is null then null else ai_devices.nonce end,
       nonce_from = case when ai_devices.approved_at is null
         then null else ai_devices.nonce_from end,
       revealed = case when ai_devices.approved_at is null then null else ai_devices.revealed end,
       pub = case when ai_devices.approved_at is null then null else ai_devices.pub end`,
  )
    .bind(user, id, name, commitment, now())
    .run()
  await told(context.env, user, id)
  return context.json({ ok: true })
})

/** A device that has the key answering one that asks: its nonce, once. The first answer
 *  stands; another device that has the key leaves this one to it. */
aiVault.put('/devices/:id/nonce', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const nonce = body.text('nonce', 100) ?? ''
  const from = body.text('from', 32) ?? ''
  const auth = body.text('auth', 100)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!BASE64.test(nonce) || !ID.test(from)) return context.json({ error: 'not a nonce' }, 400)
  if (!(await holdsTheKey(context.env, user, auth))) {
    return context.json({ error: NOT_THE_KEY }, 403)
  }

  const changed = await context.env.DB.prepare(
    `update ai_devices set nonce = ?, nonce_from = ?
      where user_id = ? and id = ? and approved_at is null and pub is null
        and (nonce is null or nonce_from = ?)`,
  )
    .bind(nonce, from, user, context.req.param('id'), from)
    .run()
  if (!changed.meta.changes) return context.json({ error: 'answered already' }, 409)
  await told(context.env, user, from)
  return context.json({ ok: true })
})

/** The asking device's key and nonce, once it has been answered: they have to be what it
 *  committed to, and the key has to be the one its id names. The first device of an
 *  account, which nobody can answer, reveals straight away. */
aiVault.put('/devices/:id/reveal', async (context) => {
  const user = context.get('user').id
  const id = context.req.param('id')
  const body = await readBody(context)
  const pub = body.text('pub', 200) ?? ''
  const nonce = body.text('nonce', 100) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  const pubBytes = BASE64.test(pub) ? bytesOf(pub) : null
  const nonceBytes = BASE64.test(nonce) ? bytesOf(nonce) : null
  if (!pubBytes || !nonceBytes) return context.json({ error: 'not a key' }, 400)

  const row = await context.env.DB.prepare(
    'select commitment, nonce, pub from ai_devices where user_id = ? and id = ?',
  )
    .bind(user, id)
    .first<{ commitment: string; nonce: string | null; pub: string | null }>()
  if (!row) return context.json({ error: NO_SUCH_DEVICE }, 404)
  if (row.pub !== null) return context.json({ error: 'revealed already' }, 409)

  // The key is the one the device's id names, and the two are what it committed to.
  if (hexOf(await digest(pubBytes), 16) !== id) {
    return context.json({ error: 'that key is not this device' }, 400)
  }
  const committed = bytesOf(row.commitment)
  const opened = await digest(pubBytes, nonceBytes)
  if (!committed || hexOf(opened) !== hexOf(committed)) {
    return context.json({ error: 'not what this device committed to' }, 400)
  }

  // Answered first, unless nothing could answer: no vault and no allowed device.
  if (row.nonce === null) {
    const vault = await context.env.DB.prepare('select 1 as one from ai_vaults where user_id = ?')
      .bind(user)
      .first()
    if (vault || (await anyAllowed(context.env, user))) {
      return context.json({ error: 'not answered yet' }, 409)
    }
  }

  await context.env.DB.prepare(
    'update ai_devices set pub = ?, revealed = ? where user_id = ? and id = ? and pub is null',
  )
    .bind(pub, nonce, user, id)
    .run()
  await told(context.env, user, id)
  return context.json({ ok: true })
})

/** The vault key wrapped to a device that revealed its key: written by a device that has
 *  the vault key. */
aiVault.put('/devices/:id/wrap', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const wrapped = body.text('wrapped', 400) ?? ''
  const from = body.text('from', 32) ?? ''
  const auth = body.text('auth', 100)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!BASE64.test(wrapped)) return context.json({ error: 'not a wrap' }, 400)
  if (!(await holdsTheKey(context.env, user, auth))) {
    return context.json({ error: NOT_THE_KEY }, 403)
  }

  const changed = await context.env.DB.prepare(
    `update ai_devices set wrapped = ?, approved_at = ?
      where user_id = ? and id = ? and pub is not null`,
  )
    .bind(wrapped, now(), user, context.req.param('id'))
    .run()
  if (!changed.meta.changes) return context.json({ error: NO_SUCH_DEVICE }, 404)
  await told(context.env, user, from)
  return context.json({ ok: true })
})

/** A device let go of: one still asking, by anyone signed in - itself, or a device turning
 *  it down - and an allowed one only by a device that has the key. */
aiVault.delete('/devices/:id', async (context) => {
  const user = context.get('user').id
  const id = context.req.param('id')
  const row = await context.env.DB.prepare(
    'select approved_at from ai_devices where user_id = ? and id = ?',
  )
    .bind(user, id)
    .first<{ approved_at: number | null }>()
  if (!row) return context.json({ error: NO_SUCH_DEVICE }, 404)
  if (row.approved_at !== null && !(await holdsTheKey(context.env, user, await authIn(context)))) {
    return context.json({ error: NOT_THE_KEY }, 403)
  }

  await context.env.DB.prepare('delete from ai_devices where user_id = ? and id = ?')
    .bind(user, id)
    .run()
  await told(context.env, user, '')
  return context.json({ ok: true })
})

/** The sealed vault written over the revision it was read at. The first write makes the
 *  vault and names its token; every later one has to send it. */
aiVault.put('/vault', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const blob = body.text('blob', MOST_VAULT) ?? ''
  const rev = body.count('rev') ?? -1
  const from = body.text('from', 32) ?? ''
  const auth = body.text('auth', 100) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!BASE64.test(blob) || !Number.isSafeInteger(rev) || rev < 0)
    return context.json({ error: 'not a vault' }, 400)
  const hash = await authHash(auth)
  if (!hash) return context.json({ error: NOT_THE_KEY }, 403)
  if (rev > 0 && !(await holdsTheKey(context.env, user, auth))) {
    return context.json({ error: NOT_THE_KEY }, 403)
  }

  const at = now()
  const written =
    rev === 0
      ? await context.env.DB.prepare(
          `insert into ai_vaults (user_id, rev, blob, auth_hash, updated_at) values (?, 1, ?, ?, ?)
           on conflict(user_id) do nothing`,
        )
          .bind(user, blob, hash, at)
          .run()
      : await context.env.DB.prepare(
          `update ai_vaults set rev = rev + 1, blob = ?, updated_at = ?
            where user_id = ? and rev = ?`,
        )
          .bind(blob, at, user, rev)
          .run()
  const held = await context.env.DB.prepare('select rev from ai_vaults where user_id = ?')
    .bind(user)
    .first<{ rev: number }>()
  if (!written.meta.changes) return context.json({ error: STALE, rev: held?.rev ?? 0 }, 409)
  await told(context.env, user, from)
  return context.json({ rev: held?.rev ?? rev + 1 })
})

/** Starting over: the vault and every wrap let go of, the devices kept so they can be let
 *  in again. By a device that has the key, or on an account with no allowed device left,
 *  which is when nobody could have it. */
aiVault.delete('/vault', async (context) => {
  const user = context.get('user').id
  const allowed =
    (await holdsTheKey(context.env, user, await authIn(context))) ||
    !(await anyAllowed(context.env, user))
  if (!allowed) return context.json({ error: NOT_THE_KEY }, 403)

  await context.env.DB.batch([
    context.env.DB.prepare('delete from ai_vaults where user_id = ?').bind(user),
    context.env.DB.prepare(
      'update ai_devices set wrapped = null, approved_at = null where user_id = ?',
    ).bind(user),
  ])
  await told(context.env, user, '')
  return context.json({ ok: true })
})
