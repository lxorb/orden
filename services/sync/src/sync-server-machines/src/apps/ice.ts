import { FALLBACK_ICE, iceServersOf, type IceServer } from '@orden/online/apps'
import { Hono } from 'hono'
import { note, NOT_FOUND, type Env, type Variables } from '../../../sync-server/src/api'
import { appsOn } from './catalogue'

const TTL = 24 * 60 * 60

export const appIce = new Hono<{ Bindings: Env; Variables: Variables }>()

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
