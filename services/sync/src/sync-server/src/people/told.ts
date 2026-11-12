import { chunks } from '../bound'
import { hooks } from '../hooks'
import type { Env, User } from '../types'

const MOST_OPEN = 200
const AT_ONCE = 50

export async function profileTold(env: Env, user: User, space?: string): Promise<void> {
  if (!env.CHATS) return
  const { results } = await env.DB.prepare(
    `select distinct chat_id as chat from chat_sockets
      where space_id in (
        select id from spaces where user_id = ?1 and deleted = 0
        union select space_id from space_members
         where email = ?2 and item = '' and joined_at is not null)
        and (?3 = '' or space_id = ?3)
      limit ?4`,
  )
    .bind(user.id, user.email, space ?? '', MOST_OPEN)
    .all<{ chat: string }>()

  for (const round of chunks(results, AT_ONCE)) {
    await Promise.all(
      round.map((one) =>
        hooks().chats.askChat(env, one.chat, 'profile', { 'x-orden-profile': `user:${user.id}` }),
      ),
    )
  }
}
