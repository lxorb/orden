import type { Env } from '../../../sync-server/src/api'

export async function zoneOf(env: Env, user: string): Promise<string> {
  const row = await env.DB.prepare('select zone from users where id = ?')
    .bind(user)
    .first<{ zone: string | null }>()
  const zone = row?.zone
  if (!zone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone
  } catch {
    return 'UTC'
  }
}
