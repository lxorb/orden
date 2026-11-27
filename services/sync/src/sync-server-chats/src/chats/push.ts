import type { Logged, Post, Who } from '@orden/chats'
import { type ChatPush, type ChatPushReason, pushText } from '@orden/chats/push'
import { liveTarget, sendPush, type Env, type PushTarget } from '../../../sync-server/src/api'
import { hubIdOf } from './reach'

export interface Posted {
  chat: string
  space: string
  logged: Logged & Post
  named: readonly Who[]
  everyone: boolean
  answered: Who | null
  reachers: readonly { id: string; guest: boolean }[]
  open: ReadonlySet<string>
}
interface Row extends PushTarget {
  notify: string | null
  muted_until: number | null
}
const OWED = `select t.id, t.user_id, t.kind, t.token, t.keys, t.zone, t.app,
       r.notify as notify, r.muted_until as muted_until
  from push_targets t
  left join chat_reads r on r.chat_id = ?1 and r.who = t.user_id
 where t.app = 'chat' and t.user_id in (select value from json_each(?2)) and ${liveTarget('?3')}
   and not exists (select 1 from chat_blocks b where b.user_id = t.user_id and b.blocked = ?4)`
function reasonFor(posted: Posted, id: string, notify: string | null): ChatPushReason | null {
  if (notify === 'nothing') return null
  if (posted.everyone || posted.named.some((who) => who === `user:${id}`)) return 'mention'
  if (posted.answered === `user:${id}`) return 'reply'
  if (notify !== 'mentions' && posted.reachers.length === 2) return 'direct'
  return notify === 'all' ? 'all' : null
}
async function nameOf(env: Env, who: Who): Promise<string> {
  const table = who.startsWith('user:') ? 'users' : who.startsWith('guest:') ? 'guests' : null
  if (!table) return ''
  const row = await env.DB.prepare(`select name from ${table} where id = ?`)
    .bind(hubIdOf(who))
    .first<{ name: string | null }>()
  return row?.name ?? ''
}
export async function pushPost(env: Env, posted: Posted, now: number): Promise<number> {
  if (!env.FCM_SERVICE_ACCOUNT && !env.APNS_KEY) return 0
  const { logged } = posted
  const author = hubIdOf(logged.author)
  const owed = posted.reachers
    .filter((one) => !one.guest && one.id !== author && !posted.open.has(one.id))
    .map((one) => one.id)
  if (!owed.length) return 0
  const { results } = await env.DB.prepare(OWED).bind(posted.chat, JSON.stringify(owed), now, logged.author).all<Row>()
  if (!results.length) return 0
  const text = pushText(logged.body)
  const name = await nameOf(env, logged.author)
  let sent = 0
  await Promise.all(
    results.map(async (row) => {
      if (row.muted_until !== null && row.muted_until > now) return
      const reason = reasonFor(posted, row.user_id, row.notify)
      if (!reason) return
      const fields: Omit<ChatPush, 'kind' | 'id' | 'title' | 'body'> = {
        v: '1',
        chat: posted.chat,
        space: posted.space,
        message: logged.message,
        seq: String(logged.seq),
        at: String(logged.at),
        from: logged.author,
        reason,
        text: text ? 'yes' : 'no',
      }
      const delivery = await sendPush(
        env,
        row,
        { kind: 'chat', id: logged.message, title: name, body: text, fields },
        now,
      )
      if (delivery === 'sent') sent++
    }),
  )
  return sent
}
