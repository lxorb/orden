import { Hono } from 'hono'
import { tokenIn } from '../auth'
import { readBody } from '../body'
import { chunks, places } from '../bound'
import { now, sha256 } from '../crypto'
import { roomsSignedOut } from '../rooms'
import type { Env, Variables } from '../types'
import { deviceIn } from '../versions'
import { machinesSignedOut } from '../machines/revoke'
import { askHub } from './reach'

export interface Hello {
  device: string
  name: string
  platform: string
  app: string
}

const NO_SUCH_DEVICE = 'no such device'

export async function deviceOfSession(
  env: Env,
  user: string,
  header: string | undefined,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `select d.id as id from devices d join sessions s on s.id = d.session_id
      where s.token_hash = ? and d.user_id = ? and d.revoked_at is null`,
  )
    .bind(await sha256(tokenIn(header) ?? ''), user)
    .first<{ id: string }>()

  return row?.id ?? null
}

export async function register(
  env: Env,
  user: string,
  session: string,
  hello: Hello,
): Promise<boolean> {
  const wrote = await env.DB.prepare(
    `insert into devices (id, user_id, session_id, name, platform, app, created_at,
                          last_seen_at)
     select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7
      where exists (select 1 from sessions where id = ?3 and user_id = ?2 and expires_at > ?7)
     on conflict(id) do update set
       session_id = excluded.session_id, platform = excluded.platform, app = excluded.app,
       last_seen_at = excluded.last_seen_at, revoked_at = null
     where devices.user_id = excluded.user_id`,
  )
    .bind(
      hello.device,
      user,
      session,
      deviceIn(hello.name) || hello.platform,
      hello.platform,
      hello.app,
      now(),
    )
    .run()
  return wrote.meta.changes > 0
}

export async function markSeen(env: Env, user: string, device: string): Promise<void> {
  await env.DB.prepare('update devices set last_seen_at = ? where id = ? and user_id = ?')
    .bind(now(), device, user)
    .run()
}

async function revokeDevice(env: Env, user: string, device: string): Promise<boolean> {
  const login = await env.DB.prepare(
    `select s.token_hash from devices d join sessions s on s.id = d.session_id and s.user_id = d.user_id
      where d.id = ? and d.user_id = ? and d.revoked_at is null`,
  )
    .bind(device, user)
    .first<{ token_hash: string }>()
  if (!(await endDevice(env, user, device))) return false

  await machinesSignedOut(env, user, login ? [login.token_hash] : [])

  await roomsSignedOut(env, user)
  return true
}

async function endDevice(env: Env, user: string, device: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'select session_id as session from devices where id = ? and user_id = ? and revoked_at is null',
  )
    .bind(device, user)
    .first<{ session: string | null }>()
  if (!row) return false

  await env.DB.batch([
    env.DB.prepare('delete from web_keys where user_id = ? and device_id = ?').bind(user, device),
    env.DB.prepare('delete from app_catalogues where user_id = ? and device_id = ?').bind(
      user,
      device,
    ),
    env.DB.prepare(
      `delete from push_targets
        where user_id = ?1
          and (device_id = ?2
               or session_hash = (select token_hash from sessions where user_id = ?1 and id = ?3))`,
    ).bind(user, device, row.session ?? ''),
    env.DB.prepare(
      'update devices set revoked_at = ?, session_id = null where id = ? and user_id = ?',
    ).bind(now(), device, user),
    env.DB.prepare('delete from sessions where user_id = ? and id = ?').bind(
      user,
      row.session ?? '',
    ),
  ])

  await askHub(env, user, 'revoke', { 'x-orden-device': device })
  return true
}

export async function devicesEnded(
  env: Env,
  user: string,
  sessions: readonly string[],
): Promise<void> {
  for (const chunk of chunks(sessions)) {
    const { results } = await env.DB.prepare(
      `select id from devices
        where user_id = ? and revoked_at is null and session_id in (${places(chunk.length)})`,
    )
      .bind(user, ...chunk)
      .all<{ id: string }>()

    for (const { id } of results) await endDevice(env, user, id)
  }

  await askHub(env, user, 'revoke', { 'x-orden-sessions': sessions.join(',') })
}

export const devices = new Hono<{ Bindings: Env; Variables: Variables }>()

devices.get('/', async (context) => {
  const user = context.get('user')
  const mine = await sha256(tokenIn(context.req.header('authorization')) ?? '')

  const { results } = await context.env.DB.prepare(
    `select d.id, d.name, d.platform, d.app, d.created_at, d.last_seen_at,
            (select 1 from sessions s where s.id = d.session_id and s.token_hash = ?2) as current
       from devices d
      where d.user_id = ?1 and d.revoked_at is null
      order by d.last_seen_at desc, d.created_at desc`,
  )
    .bind(user.id, mine)
    .all<{
      id: string
      name: string
      platform: string
      app: string | null
      created_at: number
      last_seen_at: number | null
      current: number | null
    }>()

  return context.json({
    devices: results.map((one) => ({
      id: one.id,
      name: one.name,
      platform: one.platform,
      app: one.app ?? '',
      createdAt: one.created_at,
      lastSeenAt: one.last_seen_at,
      current: one.current === 1,
    })),
  })
})

devices.patch('/:id', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const given = body.text('name', 400)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const name = deviceIn(given ?? '')
  if (!name) return context.json({ error: 'give the device a name' }, 400)

  const id = context.req.param('id')
  const changed = await context.env.DB.prepare(
    'update devices set name = ? where id = ? and user_id = ? and revoked_at is null',
  )
    .bind(name, id, user.id)
    .run()
  if (!changed.meta.changes) return context.json({ error: NO_SUCH_DEVICE }, 404)
  return context.json({ ok: true, name })
})

devices.delete('/:id', async (context) => {
  const user = context.get('user')
  const ended = await revokeDevice(context.env, user.id, context.req.param('id'))
  if (!ended) return context.json({ error: NO_SUCH_DEVICE }, 404)
  return context.json({ ok: true })
})
