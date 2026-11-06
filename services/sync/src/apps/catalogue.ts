import { catalogueOf, MOST_CATALOGUE } from '@orden/online/apps'
import { Hono } from 'hono'
import { now } from '../crypto'
import { deviceOfSession } from '../hub/devices'
import { NOT_FOUND } from '../refused'
import type { Env, Variables } from '../types'

export const appCatalogues = new Hono<{ Bindings: Env; Variables: Variables }>()

export async function appsOn(env: Env): Promise<boolean> {
  if (!env.APPS) return false
  const row = await env.DB.prepare("select value from online_service where key = 'apps'").first<{
    value: string
  }>()
  return row?.value === 'on'
}

appCatalogues.put('/', async (context) => {
  const env = context.env
  if (!(await appsOn(env))) return context.json({ error: NOT_FOUND }, 404)
  const user = context.get('user')
  const device = await deviceOfSession(env, user.id, context.req.header('authorization'))
  if (!device) return context.json({ error: 'a catalogue is written by a signed-in device' }, 409)

  const text = await context.req.text()
  if (text.length > MOST_CATALOGUE) return context.json({ error: 'too long' }, 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return context.json({ error: 'a catalogue is JSON' }, 400)
  }
  const apps = catalogueOf((parsed as { apps?: unknown } | null)?.apps)
  if (!apps) return context.json({ error: 'a catalogue is a list of applications' }, 400)

  await env.DB.prepare(
    `insert into app_catalogues (user_id, device_id, at, body) values (?1, ?2, ?3, ?4)
     on conflict(user_id, device_id) do update set at = excluded.at, body = excluded.body`,
  )
    .bind(user.id, device, now(), JSON.stringify(apps))
    .run()
  return context.json({ kept: apps.length })
})

appCatalogues.get('/:device', async (context) => {
  const env = context.env
  if (!(await appsOn(env))) return context.json({ error: NOT_FOUND }, 404)
  const user = context.get('user')
  const row = await env.DB.prepare(
    `select c.at as at, c.body as body from app_catalogues c
       join devices d on d.id = c.device_id and d.user_id = c.user_id and d.revoked_at is null
      where c.user_id = ? and c.device_id = ?`,
  )
    .bind(user.id, context.req.param('device'))
    .first<{ at: number; body: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)
  let stored: unknown
  try {
    stored = JSON.parse(row.body)
  } catch {
    stored = null
  }
  return context.json({ at: row.at, apps: catalogueOf(stored) ?? [] })
})
