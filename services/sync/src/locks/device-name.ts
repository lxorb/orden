import type { Env } from '../types'

/** The name a person's device gave itself, as a header carries it; empty where it has
 *  none here. Never one of somebody else's devices, whatever id a socket names. */
export async function deviceName(env: Env, device: string, who: string): Promise<string> {
  const row = await env.DB.prepare(
    'select name from devices where id = ?1 and user_id = ?2 and revoked_at is null',
  )
    .bind(device, who)
    .first<{ name: string }>()
    .catch(() => null)
  // Escaped: a header carries no `’`, which a device's name often has.
  return encodeURIComponent((row?.name ?? '').slice(0, 100))
}
