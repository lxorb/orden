import { AT_A_TIME, places } from '../bound'
import type { Env } from '../types'
import { noteChatFiles } from '../unused'

const KEPT_FOR = 30 * 24 * 60 * 60 * 1000

export async function sweepChats(env: Env, at: number): Promise<number> {
  await env.DB.prepare(
    `update chats set ended_at = ?1
      where ended_at is null
        and ((file_id is not null and not exists (select 1 from notes n where n.id = chats.file_id
                                                     and not (n.deleted = 1 and n.deleted_at is null)))
             or exists (select 1 from spaces s where s.id = chats.space_id
                           and s.deleted = 1 and s.deleted_at is null))`,
  )
    .bind(at)
    .run()

  const { results } = await env.DB.prepare(
    'select id from chats where ended_at is not null and ended_at < ? limit ?',
  )
    .bind(at - KEPT_FOR, AT_A_TIME)
    .all<{ id: string }>()
  if (!results.length) return 0

  const ids = results.map((one) => one.id)
  const list = places(ids.length)
  await env.DB.batch([
    env.DB.prepare(
      `insert or ignore into leftovers (what, since)
         select 'chats/' || id, ? from chats where id in (${list})`,
    ).bind(at, ...ids),
    noteChatFiles(env, 'f.chat_id in (select value from json_each(?2))', at, JSON.stringify(ids)),
    env.DB.prepare(`delete from chat_reads where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chat_files where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chat_sockets where chat_id in (${list})`).bind(...ids),
    env.DB.prepare(`delete from chats where id in (${list})`).bind(...ids),
  ])
  return ids.length
}
