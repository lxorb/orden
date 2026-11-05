/** The servers a viewer's connection to an application's host may use (issue 1063, step
 *  4; docs/apps.md): `GET /v2/apps/ice`. STUN always, so a viewer learns the address the
 *  internet sees it at; and TURN, with credentials that last a day, where the Worker has
 *  a Cloudflare TURN key (`TURN_KEY_ID` and `TURN_KEY_TOKEN`, secrets set by the owner),
 *  for two devices that cannot reach each other directly. Only the viewer relays: the
 *  host answers a relayed candidate from its own address. Behind the door's switch. */

import { FALLBACK_ICE, iceServersOf, type IceServer } from '@orden/online/apps'
import { Hono } from 'hono'
import { note } from '../failed'
import { NOT_FOUND } from '../refused'
import type { Env, Variables } from '../types'
import { appsOn } from './catalogue'

/** How long a TURN credential lasts. */
const TTL = 24 * 60 * 60

export const appIce = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The servers to hand out: Cloudflare's, with credentials, where there is a key; its
 *  STUN alone where there is none or it does not answer. */
async function iceServers(env: Env): Promise<IceServer[]> {
  const id = env.TURN_KEY_ID
  const token = env.TURN_KEY_TOKEN
  if (!id || !token) return [...FALLBACK_ICE]
  const answer = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
    },
  ).catch((error: unknown) => {
    note('turn credentials', error, null)
    return null
  })
  if (!answer?.ok) return [...FALLBACK_ICE]
  const body: unknown = await answer.json().catch(() => null)
  const servers = iceServersOf((body as { iceServers?: unknown } | null)?.iceServers)
  return servers.length > 0 ? servers : [...FALLBACK_ICE]
}

appIce.get('/', async (context) => {
  const env = context.env
  if (!(await appsOn(env))) return context.json({ error: NOT_FOUND }, 404)
  return context.json({ iceServers: await iceServers(env) }, 200, { 'cache-control': 'no-store' })
})
