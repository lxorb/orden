import type { Env } from '../types'
import { budgetLeft } from './budget'
import { ALLOWANCE } from '@orden/online'
import { hetznerMissing } from './hetzner-host'
import { DevHost } from './host'
import { usedOf } from './meter'
import type { Refusal } from '@orden/online/wire'
import { type Service, serviceOf } from './service'

export async function whyNotWake(
  env: Env,
  userId: string,
  at: number,
  known?: Service,
): Promise<Refusal | null> {
  const service = known ?? (await serviceOf(env))
  if (!service.on) return 'off'

  const row = await env.DB.prepare(
    `select u.online as online, m.held as held, m.host as host, m.server_id as server
       from users u left join machines m on m.user_id = u.id where u.id = ?`,
  )
    .bind(userId)
    .first<{ online: number; held: string | null; host: string | null; server: number | null }>()
  if (row?.online !== 1) return 'list'
  if (row.held) return 'flag'

  if (row.host === 'hetzner') {
    if (hetznerMissing(env).length && !DevHost.of(env)) return 'off'
    if (row.server !== null) return null
  }

  if ((await budgetLeft(env, service.ceiling, at)) <= 0) return 'budget'
  if (row.host === 'hetzner') return null

  const used = await usedOf(env, userId, at)
  const spent =
    used.awakeS >= ALLOWANCE.awakeS ||
    used.cpuS >= ALLOWANCE.cpuS ||
    used.egressBytes >= ALLOWANCE.egressBytes
  return spent ? 'allowance' : null
}
