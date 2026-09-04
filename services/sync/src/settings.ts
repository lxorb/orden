import { Hono } from 'hono'
import type { Env, Variables } from './types'

/** The settings that follow the account from machine to machine, and what
 *  each may be. Anything else in a request is refused, so the column never
 *  holds what no version of the app knows what to do with. */
const KNOWN: Record<string, 'boolean'> = {
  ligatures: 'boolean',
}

export type AccountSettings = Record<string, boolean>

export async function settingsOf(env: Env, userId: string): Promise<AccountSettings> {
  const row = await env.DB.prepare('select settings from users where id = ?')
    .bind(userId)
    .first<{ settings: string }>()
  return parse(row?.settings)
}

function parse(raw: string | undefined): AccountSettings {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as AccountSettings) : {}
  } catch {
    return {}
  }
}

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>()

settings.get('/', async (context) => {
  return context.json({ settings: await settingsOf(context.env, context.get('user').id) })
})

/** Changes what is sent and leaves the rest as it was. */
settings.patch('/', async (context) => {
  const user = context.get('user')
  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
    const kind = KNOWN[name]
    if (!kind) return context.json({ error: `unknown setting ${name}` }, 400)
    if (typeof value !== kind) return context.json({ error: `${name} must be true or false` }, 400)
  }

  const merged = { ...(await settingsOf(context.env, user.id)), ...(body as AccountSettings) }
  await context.env.DB.prepare('update users set settings = ? where id = ?')
    .bind(JSON.stringify(merged), user.id)
    .run()
  return context.json({ settings: merged })
})
