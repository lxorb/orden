/** What each of the reader's computers has installed (issue 1063, step 3): the list New
 *  application offers once a computer is chosen, so an application is picked by its name
 *  and its icon rather than typed as a path.
 *
 *  A host writes its own, `PUT /v2/apps/catalogue`, as it starts serving applications and
 *  whenever the list it finds changes; the device is the session's, never one the request
 *  names. Any of the reader's devices reads one by the host's id,
 *  `GET /v2/apps/catalogue/:device`. The list is only ever what to offer: a host starts an
 *  installed application by the id it found itself, never by a name or a command line from
 *  here. Behind the same switch as the door (`apps` in `online_service`), and gone with the
 *  device when it is ended and with the account. */

import { catalogueOf, MOST_CATALOGUE } from '@orden/online/apps'
import { Hono } from 'hono'
import { now } from '../crypto'
import { deviceOfSession } from '../hub/devices'
import { NOT_FOUND } from '../refused'
import type { Env, Variables } from '../types'

export const appCatalogues = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Whether applications are switched on: the door's switch. */
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
  // Only a device the account has and has not ended: an ended laptop's list is not one
  // to start anything from.
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
