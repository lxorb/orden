import type { Env } from '../types'
import type { Presence } from './profile'

export interface Held {
  active: boolean
  guest: boolean
}

export function presenceOf(sockets: readonly Held[]): Presence {
  const theirs = sockets.filter((one) => !one.guest)
  if (!theirs.length) return 'offline'
  return theirs.some((one) => one.active) ? 'active' : 'away'
}

export async function keepPresence(env: Env, user: string, state: Presence): Promise<void> {
  await env.DB.prepare(
    `insert into presence (user_id, state, at) values (?1, ?2, ?3)
     on conflict(user_id) do update set state = excluded.state, at = excluded.at
      where presence.state <> excluded.state`,
  )
    .bind(user, state, Date.now())
    .run()
}
