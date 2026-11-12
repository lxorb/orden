import { type Context, Hono } from 'hono'
import {
  readBody,
  now,
  bytesOf,
  digest,
  hexOf,
  opens,
  askHub,
  deviceIn,
  type Env,
  type Variables,
} from '../../../sync-server/src/api'
type Vault = Context<{ Bindings: Env; Variables: Variables }>

const MOST_DEVICES = 30

const MOST_VAULT = 512 * 1024

const ID = /^[a-f0-9]{32}$/
const BASE64 = /^[A-Za-z0-9+/=_-]+$/

const NO_SUCH_DEVICE = 'no such device'
const STALE = 'stale'
const NOT_THE_KEY = 'not the vault key'

export const aiVault = new Hono<{ Bindings: Env; Variables: Variables }>()

function told(env: Env, user: string, from: string): Promise<unknown> {
  return askHub(env, user, 'ai', { 'x-orden-from': from }).catch(() => null)
}

async function authHash(auth: string): Promise<string | null> {
  const bytes = BASE64.test(auth) ? bytesOf(auth) : null
  return bytes ? hexOf(await digest(bytes)) : null
}

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

async function anyAllowed(env: Env, user: string): Promise<boolean> {
  const found = await env.DB.prepare(
    'select 1 as one from ai_devices where user_id = ? and approved_at is not null limit 1',
  )
    .bind(user)
    .first()
  return found !== null
}

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

  const added = await context.env.DB.prepare(
    `insert into ai_devices (user_id, id, name, commitment, created_at)
     select ?1, ?2, ?3, ?4, ?5
      where (select count(*) from ai_devices where user_id = ?1 and id != ?2) < ?6
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
    .bind(user, id, name, commitment, now(), MOST_DEVICES)
    .run()
  if (!added.meta.changes) return context.json({ error: 'too many devices' }, 409)
  await told(context.env, user, id)
  return context.json({ ok: true })
})

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

  if (hexOf(await digest(pubBytes), 16) !== id) {
    return context.json({ error: 'that key is not this device' }, 400)
  }
  if (!(await opens(row.commitment, pub, nonce))) {
    return context.json({ error: 'not what this device committed to' }, 400)
  }

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
  if (row.approved_at !== null) {
    const others = await context.env.DB.prepare(
      'select 1 as one from ai_devices where user_id = ? and id != ? and approved_at is not null',
    )
      .bind(user, id)
      .first()
    if (others) return context.json({ error: 'change the key instead' }, 409)
  }

  await context.env.DB.prepare('delete from ai_devices where user_id = ? and id = ?')
    .bind(user, id)
    .run()
  await told(context.env, user, '')
  return context.json({ ok: true })
})

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

aiVault.put('/rotate', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const blob = body.text('blob', MOST_VAULT) ?? ''
  const rev = body.count('rev') ?? -1
  const from = body.text('from', 32) ?? ''
  const auth = body.text('auth', 100)
  const next = body.text('next', 100) ?? ''
  const keep = body.texts('keep', MOST_DEVICES, 32) ?? []
  const wraps = body.texts('wraps', MOST_DEVICES, 400) ?? []
  const go = body.texts('go', MOST_DEVICES, 32) ?? []
  if (body.problem) return context.json({ error: body.problem }, 400)
  const nextHash = await authHash(next)
  if (
    !BASE64.test(blob) ||
    !Number.isSafeInteger(rev) ||
    rev < 1 ||
    !nextHash ||
    !go.length ||
    !keep.length ||
    keep.length !== wraps.length ||
    ![...keep, ...go].every((one) => ID.test(one)) ||
    !wraps.every((one) => BASE64.test(one)) ||
    keep.some((one) => go.includes(one))
  ) {
    return context.json({ error: 'not a new key' }, 400)
  }
  if (!(await holdsTheKey(context.env, user, auth))) {
    return context.json({ error: NOT_THE_KEY }, 403)
  }
  const oldHash = (await authHash(auth ?? '')) ?? ''

  const changed = `exists (select 1 from ai_vaults where user_id = ?1 and rev = ?2 and auth_hash = ?3)`
  const after = [user, rev + 1, nextHash] as const
  const marks = (ids: readonly string[], first: number) =>
    ids.map((_, at) => `?${String(at + first)}`).join(', ')
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `update ai_vaults set rev = rev + 1, blob = ?, auth_hash = ?, updated_at = ?
        where user_id = ? and rev = ? and auth_hash = ?`,
    ).bind(blob, nextHash, now(), user, rev, oldHash),
    ...keep.map((id, at) =>
      context.env.DB.prepare(
        `update ai_devices set wrapped = ?4 where user_id = ?1 and id = ?5
           and approved_at is not null and ${changed}`,
      ).bind(...after, wraps[at] ?? '', id),
    ),
    context.env.DB.prepare(
      `delete from ai_devices where user_id = ?1 and id in (${marks(go, 4)}) and ${changed}`,
    ).bind(...after, ...go),
    context.env.DB.prepare(
      `update ai_devices set wrapped = null, approved_at = null, nonce = null, nonce_from = null,
              pub = null, revealed = null
        where user_id = ?1 and approved_at is not null
          and id not in (${marks(keep, 4)}) and ${changed}`,
    ).bind(...after, ...keep),
    context.env.DB.prepare(
      `update ai_devices set nonce = null, nonce_from = null, pub = null, revealed = null
        where user_id = ?1 and approved_at is null and nonce_from in (${marks(go, 4)})
          and ${changed}`,
    ).bind(...after, ...go),
  ])
  if (!results[0]?.meta.changes) {
    const held = await context.env.DB.prepare('select rev from ai_vaults where user_id = ?')
      .bind(user)
      .first<{ rev: number }>()
    return context.json({ error: STALE, rev: held?.rev ?? 0 }, 409)
  }
  await told(context.env, user, from)
  return context.json({ rev: rev + 1 })
})

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
