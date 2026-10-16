/** The reader's AI accounts, kept for every device of the account and readable on none
 *  but theirs (docs/ai.md, "Every device").
 *
 *  The account holds two kinds of ciphertext and no key. The vault is the accounts and
 *  their API keys, sealed on a device with a key only the account's devices have; each
 *  device that has that key holds it wrapped to its own public key. A new device
 *  registers its public key and waits; any device that already has the key shows the
 *  same six digits the new one shows, and one press wraps the key to it. So the server
 *  never sees a key, and a server that swapped in a public key of its own would show
 *  different digits. The shape is web logins' (docs/sync-v2.md 6.6), on routes rather
 *  than the hub, because a phone and a browser carry AI accounts too.
 *
 *  Every change is said to the account's hub, which tells its devices to read again.
 *  A write names the revision it read, and one over a newer revision is refused, so a
 *  device merges and writes again rather than writing another's change away. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { now } from '../crypto'
import { askHub } from '../hub/reach'
import type { Env, Variables } from '../types'
import { deviceIn } from '../versions'

/** The most devices an account keeps for its AI accounts. */
const MOST_DEVICES = 30

/** The most a sealed vault may be: hundreds of accounts and their keys. */
const MOST_VAULT = 512 * 1024

/** A device's id, a public key and a wrap: what a device makes, base64 or hex. */
const ID = /^[a-f0-9]{32}$/
const BASE64 = /^[A-Za-z0-9+/=_-]+$/

const NO_SUCH_DEVICE = 'no such device'
const STALE = 'stale'

export const aiVault = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The account's devices, told to read the vault again; never the one that wrote. */
function told(env: Env, user: string, from: string): Promise<unknown> {
  return askHub(env, user, 'ai', { 'x-nib-from': from }).catch(() => null)
}

interface VaultRow {
  rev: number
  blob: string
}

interface DeviceRow {
  id: string
  name: string
  pub: string
  wrapped: string | null
  approved_at: number | null
}

/** Everything a device reads: the vault, the devices, and the key wrapped to it. */
aiVault.get('/', async (context) => {
  const user = context.get('user').id
  const device = context.req.query('device') ?? ''
  const [vault, devices] = await Promise.all([
    context.env.DB.prepare('select rev, blob from ai_vaults where user_id = ?')
      .bind(user)
      .first<VaultRow>(),
    context.env.DB.prepare(
      `select id, name, pub, wrapped, approved_at from ai_devices where user_id = ?
        order by created_at`,
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
      approved: one.approved_at !== null,
    })),
  })
})

/** A device known by its public key: made, or brought up to date. A new key takes the
 *  key wrapped to the old one with it, since nothing can open that any more. */
aiVault.post('/devices', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const id = body.text('id', 32) ?? ''
  const pub = body.text('pub', 200) ?? ''
  const name = deviceIn(body.text('name', 200) ?? '') || 'Device'
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!ID.test(id) || !BASE64.test(pub)) return context.json({ error: 'not a device' }, 400)

  const count = await context.env.DB.prepare(
    'select count(*) as n from ai_devices where user_id = ? and id != ?',
  )
    .bind(user, id)
    .first<{ n: number }>()
  if ((count?.n ?? 0) >= MOST_DEVICES) return context.json({ error: 'too many devices' }, 409)

  await context.env.DB.prepare(
    `insert into ai_devices (user_id, id, name, pub, created_at) values (?1, ?2, ?3, ?4, ?5)
     on conflict(user_id, id) do update set
       name = excluded.name,
       wrapped = case when ai_devices.pub = excluded.pub then ai_devices.wrapped end,
       approved_at = case when ai_devices.pub = excluded.pub then ai_devices.approved_at end,
       pub = excluded.pub`,
  )
    .bind(user, id, name, pub, now())
    .run()
  await told(context.env, user, id)
  return context.json({ ok: true })
})

/** The vault key wrapped to a device: written by a device that has it. */
aiVault.put('/devices/:id/wrap', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const wrapped = body.text('wrapped', 400) ?? ''
  const from = body.text('from', 32) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!BASE64.test(wrapped)) return context.json({ error: 'not a wrap' }, 400)

  const changed = await context.env.DB.prepare(
    'update ai_devices set wrapped = ?, approved_at = ? where user_id = ? and id = ?',
  )
    .bind(wrapped, now(), user, context.req.param('id'))
    .run()
  if (!changed.meta.changes) return context.json({ error: NO_SUCH_DEVICE }, 404)
  await told(context.env, user, from)
  return context.json({ ok: true })
})

/** A device let go of: not allowed, or removed. */
aiVault.delete('/devices/:id', async (context) => {
  const user = context.get('user').id
  const changed = await context.env.DB.prepare(
    'delete from ai_devices where user_id = ? and id = ?',
  )
    .bind(user, context.req.param('id'))
    .run()
  if (!changed.meta.changes) return context.json({ error: NO_SUCH_DEVICE }, 404)
  await told(context.env, user, '')
  return context.json({ ok: true })
})

/** The sealed vault written over the revision it was read at. */
aiVault.put('/vault', async (context) => {
  const user = context.get('user').id
  const body = await readBody(context)
  const blob = body.text('blob', MOST_VAULT) ?? ''
  const rev = body.count('rev') ?? -1
  const from = body.text('from', 32) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!BASE64.test(blob) || !Number.isSafeInteger(rev) || rev < 0)
    return context.json({ error: 'not a vault' }, 400)

  const at = now()
  const written =
    rev === 0
      ? await context.env.DB.prepare(
          `insert into ai_vaults (user_id, rev, blob, updated_at) values (?, 1, ?, ?)
           on conflict(user_id) do nothing`,
        )
          .bind(user, blob, at)
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

/** Starting over, for an account none of whose devices has the key any more: the vault
 *  and every wrap let go of, the devices kept so they can be allowed again. */
aiVault.delete('/vault', async (context) => {
  const user = context.get('user').id
  await context.env.DB.batch([
    context.env.DB.prepare('delete from ai_vaults where user_id = ?').bind(user),
    context.env.DB.prepare(
      'update ai_devices set wrapped = null, approved_at = null where user_id = ?',
    ).bind(user),
  ])
  await told(context.env, user, '')
  return context.json({ ok: true })
})
