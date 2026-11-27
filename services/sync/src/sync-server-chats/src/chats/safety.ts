import type { Message, Who } from '@orden/chats'
import { isWho } from '@orden/chats/wire'
import { Hono } from 'hono'
import { mailer, mayMail, newId, now, oneLine, within, type Env, type Variables } from '../../../sync-server/src/api'
import { askChat } from './ask'
import { reachChat, reaching } from './reach'

interface App {
  Bindings: Env
  Variables: Variables
}
export const MOST_BLOCKED = 500
const LONGEST_REASON = 1000
const LONGEST_SNAPSHOT = 1000
const REPORTS_AN_HOUR = 20
const MAILED_AT_ONCE = 20
const KEPT_FOR = 365 * 24 * 60 * 60 * 1000
const NO_SUCH_CHAT = 'no such chat'
const NOT_THAT = 'that is not what this route reads'
const ONLY_ACCOUNTS = 'only somebody with an account can do this'
const isPerson = (value: unknown): value is Who => isWho(value) && !value.startsWith('program:')
export const safety = new Hono<App>()
safety.get('/blocks', async (context) => {
  const who = context.get('who')
  if (who.kind !== 'user') return context.json({ blocked: [] })
  const { results } = await context.env.DB.prepare(
    'select blocked from chat_blocks where user_id = ? order by created_at, blocked',
  )
    .bind(who.user.id)
    .all<{ blocked: string }>()
  return context.json({ blocked: results.map((one) => one.blocked) })
})
safety.put('/blocks/:who', async (context) => {
  const who = context.get('who')
  if (who.kind !== 'user') return context.json({ error: ONLY_ACCOUNTS }, 403)
  const blocked = context.req.param('who')
  if (!isPerson(blocked) || blocked === `user:${who.user.id}`) return context.json({ error: NOT_THAT }, 400)
  await context.env.DB.prepare(
    `insert into chat_blocks (user_id, blocked, created_at)
     select ?1, ?2, ?3 where (select count(*) from chat_blocks where user_id = ?1) < ?4
     on conflict (user_id, blocked) do nothing`,
  )
    .bind(who.user.id, blocked, now(), MOST_BLOCKED)
    .run()
  const held = await context.env.DB.prepare('select 1 as yes from chat_blocks where user_id = ? and blocked = ?')
    .bind(who.user.id, blocked)
    .first<{ yes: number }>()
  return held ? context.json({ ok: true }) : context.json({ error: 'that is too many people blocked' }, 409)
})
safety.delete('/blocks/:who', async (context) => {
  const who = context.get('who')
  if (who.kind !== 'user') return context.json({ error: ONLY_ACCOUNTS }, 403)
  await context.env.DB.prepare('delete from chat_blocks where user_id = ? and blocked = ?')
    .bind(who.user.id, context.req.param('who'))
    .run()
  return context.json({ ok: true })
})
interface Report {
  id: string
  reporter: string
  chat_id: string
  space_id: string
  message_id: string | null
  reported: string
  reason: string
  body: string
  created_at: number
}
async function messageIn(env: Env, chat: string, id: string): Promise<Message | null> {
  const query = new URLSearchParams({ id }).toString()
  const answer = await askChat(env, chat, 'message', {}, { url: `https://chats.invalid/${chat}?${query}` })
  if (!answer?.ok) return null
  return (await answer.json<{ message: Message | null }>()).message
}
async function reaches(env: Env, chat: string, who: Who): Promise<boolean> {
  const id = who.slice(who.indexOf(':') + 1)
  const guest = who.startsWith('guest:')
  return (await reaching(env, chat)).some((one) => one.id === id && one.guest === guest)
}
function reportMail(reports: readonly Report[]) {
  const lines = reports.flatMap((one) => [
    `Report ${one.id}`,
    `At: ${new Date(one.created_at).toISOString()}`,
    `Reporter: ${one.reporter ? `account ${one.reporter}` : 'an account since deleted'}`,
    `Reported: ${one.reported}`,
    `Chat: ${one.chat_id} in space ${one.space_id}`,
    `Message: ${one.message_id ?? 'none, the person is reported'}`,
    `Reason: ${one.reason || 'none given'}`,
    ...(one.body ? [`Message text: ${one.body}`] : []),
    '',
  ])
  const text = lines.join('\n')
  const escaped = text.replace(/[&<>]/g, (one) => (one === '&' ? '&amp;' : one === '<' ? '&lt;' : '&gt;'))
  return {
    subject: oneLine(
      reports.length === 1 ? 'A chat report on Orden' : `${String(reports.length)} chat reports on Orden`,
    ),
    text,
    html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${escaped}</pre>`,
  }
}
export async function mailReports(env: Env): Promise<number> {
  const to = env.CHAT_REPORTS_TO?.trim()
  if (!to) return 0
  const { results } = await env.DB.prepare(
    `select id, reporter, chat_id, space_id, message_id, reported, reason, body, created_at
       from chat_reports where mailed_at is null order by created_at limit ?`,
  )
    .bind(MAILED_AT_ONCE)
    .all<Report>()
  if (!results.length || !(await mayMail(env, to, null)).ok) return 0
  const message = reportMail(results)
  if (!(await mailer(env).send(to, message.subject, message))) return 0
  const at = now()
  await env.DB.batch(
    results.map((one) =>
      env.DB.prepare('update chat_reports set mailed_at = ? where id = ? and mailed_at is null').bind(at, one.id),
    ),
  )
  return results.length
}
export async function sweepReports(env: Env, at: number): Promise<number> {
  const swept = await env.DB.prepare('delete from chat_reports where created_at < ?')
    .bind(at - KEPT_FOR)
    .run()
  return swept.meta.changes
}
safety.post('/:chat/reports', async (context) => {
  const env = context.env
  const who = context.get('who')
  const reached = await reachChat(env, who, context.req.param('chat'))
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  if (who.kind !== 'user') return context.json({ error: ONLY_ACCOUNTS }, 403)
  const sent = (await context.req.json().catch(() => null)) as Record<string, unknown> | null
  const reason = sent?.reason ?? ''
  const named = sent?.message
  if (!sent || typeof reason !== 'string' || reason.length > LONGEST_REASON) {
    return context.json({ error: NOT_THAT }, 400)
  }
  if (named !== undefined && (typeof named !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(named))) {
    return context.json({ error: NOT_THAT }, 400)
  }
  let reported: Who
  let body = ''
  if (typeof named === 'string') {
    const message = await messageIn(env, reached.chat, named)
    if (!message) return context.json({ error: 'no such message' }, 404)
    reported = message.author
    body = message.body.slice(0, LONGEST_SNAPSHOT)
  } else {
    if (!isPerson(sent.who)) return context.json({ error: NOT_THAT }, 400)
    if (!(await reaches(env, reached.chat, sent.who))) return context.json({ error: 'no such member' }, 404)
    reported = sent.who
  }
  if (reported === `user:${who.user.id}`) return context.json({ error: NOT_THAT }, 400)
  if (!(await within(env, 'chat-reports', who.user.id, REPORTS_AN_HOUR, 3_600_000))) {
    return context.json({ error: 'that is too many reports for now' }, 429)
  }
  const id = newId()
  await env.DB.prepare(
    `insert into chat_reports (id, reporter, chat_id, space_id, message_id, reported, reason, body, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, who.user.id, reached.chat, reached.space, named ?? null, reported, reason.trim(), body, now())
    .run()
  await mailReports(env)
  return context.json({ id }, 201)
})
