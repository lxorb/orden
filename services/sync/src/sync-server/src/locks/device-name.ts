import type { Env } from '../types'

export async function deviceName(env: Env, device: string, who: string): Promise<string> {
  const row = await env.DB.prepare(
    'select name from devices where id = ?1 and user_id = ?2 and revoked_at is null',
  )
    .bind(device, who)
    .first<{ name: string }>()
    .catch(() => null)
  return encodeURIComponent((row?.name ?? '').slice(0, 100))
}
