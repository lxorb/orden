import { chunks } from '../bound'
import type { Env } from '../types'
import type { ChatAsk } from './log'

export const CHAT_AWAY = 'this chat is not answering - try again'

const AT_ONCE = 50

export async function askChat(
  env: Env,
  chat: string,
  ask: ChatAsk,
  headers: Record<string, string> = {},
  init: { url?: string; body?: string } = {},
): Promise<Response | null> {
  const namespace = env.CHATS
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const log = namespace.get(namespace.idFromName(chat))
      return await log.fetch(
        new Request(init.url ?? `https://chats.invalid/${chat}`, {
          method: init.body === undefined ? 'GET' : 'POST',
          headers: { ...headers, 'x-orden-chat-ask': ask, 'x-orden-chat': chat },
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

async function tell(env: Env, chat: string, ask: ChatAsk, headers: Record<string, string>) {
  const answer = await askChat(env, chat, ask, headers)
  return answer?.ok === true
}

const MOST_OPEN = 200

const MOST_ROUNDS = 20

export async function chatsRevoked(
  env: Env,
  spaceId: string,
  who: string,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  if (!env.CHATS) return

  let after = ''
  for (let round = 0; round < MOST_ROUNDS; round++) {
    const { results } = await env.DB.prepare(
      `select s.chat_id as chat from chat_sockets s join chats c on c.id = s.chat_id
        where s.space_id = ?1 and s.who = ?2 and (?3 = '' or c.file_id = ?3)
          and s.chat_id > ?4
        order by s.chat_id limit ?5`,
    )
      .bind(spaceId, who, item, after, MOST_OPEN)
      .all<{ chat: string }>()

    for (const some of chunks(results, AT_ONCE)) {
      await Promise.all(
        some.map((one) =>
          tell(env, one.chat, 'revoke', { 'x-orden-revoked': who, 'x-orden-role': role }),
        ),
      )
    }

    if (results.length < MOST_OPEN) return
    after = results[results.length - 1]?.chat ?? ''
  }
}

export async function chatsMoved(env: Env, chat: string, space: string): Promise<void> {
  await env.DB.prepare('update chats set space_id = ?, file_id = null where id = ?')
    .bind(space, chat)
    .run()
  const { results } = await env.DB.prepare('select who from chat_sockets where chat_id = ?')
    .bind(chat)
    .all<{ who: string }>()
  await closeChats(
    env,
    results.map((one) => ({ chat_id: chat, who: one.who })),
  )
}

export async function closeChats(
  env: Env,
  open: readonly { chat_id: string; who: string }[],
): Promise<void> {
  if (!env.CHATS) return
  for (const round of chunks(open, AT_ONCE)) {
    await Promise.all(
      round.map((one) =>
        tell(env, one.chat_id, 'revoke', { 'x-orden-revoked': one.who, 'x-orden-role': 'none' }),
      ),
    )
  }
}

export async function eraseChats(env: Env, chats: readonly string[]): Promise<string[]> {
  if (!env.CHATS) return [...chats]
  const emptied: string[] = []
  for (const round of chunks(chats, AT_ONCE)) {
    const heard = await Promise.all(round.map((chat) => tell(env, chat, 'erase', {})))
    emptied.push(...round.filter((_, at) => heard[at]))
  }
  return emptied
}
