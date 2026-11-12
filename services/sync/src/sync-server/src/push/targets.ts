import { Hono } from 'hono'
import { readBody } from '../body'
import { tokenIn } from '../auth'
import { newId, now, sha256 } from '../crypto'
import type { Env, Variables } from '../types'
import { configured, type TargetKind } from './send'

const KINDS: readonly TargetKind[] = ['webpush', 'fcm', 'apns']

const LONGEST_TOKEN = 2048
const LONGEST_KEY = 200
const LONGEST_ZONE = 64

const MOST_TARGETS = 20

const NOT_A_TARGET = 'not a push target'

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const push = new Hono<{ Bindings: Env; Variables: Variables }>()

push.get('/key', (context) => context.json(configured(context.env)))

push.post('/targets', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const kind = body.text('kind', 10)
  const token = body.text('token', LONGEST_TOKEN)
  const p256dh = body.text('p256dh', LONGEST_KEY)
  const auth = body.text('auth', LONGEST_KEY)
  const zone = body.text('zone', LONGEST_ZONE)
  const device = body.text('device', 100)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const known = KINDS.find((one) => one === kind)
  if (!known || !token) return context.json({ error: NOT_A_TARGET }, 400)
  if (known === 'webpush' && (!token.startsWith('https://') || !p256dh || !auth)) {
    return context.json({ error: NOT_A_TARGET }, 400)
  }
  if (zone !== undefined && !isZone(zone)) return context.json({ error: NOT_A_TARGET }, 400)

  const keys = known === 'webpush' ? JSON.stringify({ p256dh, auth }) : null
  const session = await sha256(tokenIn(context.req.header('authorization')) ?? '')
  const id = newId()
  await context.env.DB.prepare(
    `insert into push_targets (id, user_id, device_id, kind, token, keys, zone, created_at,
                               session_hash)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (user_id, token) do update
       set kind = excluded.kind, keys = excluded.keys, zone = excluded.zone,
           device_id = excluded.device_id, created_at = excluded.created_at, failed_at = null,
           session_hash = excluded.session_hash`,
  )
    .bind(id, user.id, device ?? null, known, token, keys, zone ?? null, now(), session)
    .run()
  await context.env.DB.prepare(
    `delete from push_targets where user_id = ?1 and id not in
       (select id from push_targets where user_id = ?1 order by created_at desc limit ?2)`,
  )
    .bind(user.id, MOST_TARGETS)
    .run()

  const row = await context.env.DB.prepare(
    'select id from push_targets where user_id = ? and token = ?',
  )
    .bind(user.id, token)
    .first<{ id: string }>()
  return context.json({ id: row?.id ?? id })
})

push.delete('/targets/:id', async (context) => {
  const user = context.get('user')
  await context.env.DB.prepare('delete from push_targets where id = ? and user_id = ?')
    .bind(context.req.param('id'), user.id)
    .run()
  return context.json({ ok: true })
})
