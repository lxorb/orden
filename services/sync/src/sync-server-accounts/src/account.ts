import { Hono } from 'hono'
import {
  type Env,
  leavingMessage,
  leavingSetMessage,
  leavingSoonMessage,
  machineOf,
  mailCeilings,
  mailer,
  mailNotSent,
  mayLeave,
  note,
  now,
  randomToken,
  readBody,
  refusedMail,
  sha256,
  TOOK_TOO_LONG,
  TRY_IN_AN_HOUR,
  type User,
  type Variables,
  WRONG_CODE,
} from '../../sync-server/src/api'
import { eraseAccount } from '../../sync-server-engine/src/api'
import { addresses } from './addresses'
import { checkCode, endEverySession, sendCode, spendCode } from './auth'
import { accepted, asksForSecond } from './second'

const TICKETS = 'leaving'
const TICKET_FOR = 5 * 60 * 1000
const LEFT = 'left'
const LEFT_FOR = 24 * 60 * 60 * 1000
const A_DAY = 24 * 60 * 60 * 1000
export const KEPT_FOR = 30 * A_DAY
const WARNED_BEFORE = 3 * A_DAY
const GONE_AT_ONCE = 10
const WARNED_AT_ONCE = 50
function dayOf(at: number): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
async function told(env: Env, address: string, message: { subject: string; text: string; html: string }) {
  if (await mailCeilings(env, address, null)) return false
  if (await mailer(env).send(address, message.subject, message)) return true
  await mailNotSent(env, address)
  return false
}
export async function sweepLeaving(env: Env, at: number): Promise<void> {
  const { results: due } = await env.DB.prepare(
    `select id, email, name, created_at from users
      where delete_after is not null and delete_after <= ? order by delete_after limit ?`,
  )
    .bind(at, GONE_AT_ONCE)
    .all<User>()
  for (const user of due) {
    try {
      await eraseAccount(env, user)
    } catch (error) {
      note('leaving', error, null)
    }
  }
  const { results: soon } = await env.DB.prepare(
    `select id, email, delete_after from users
      where delete_after > ?1 and delete_after <= ?2 and delete_warned_at is null
      order by delete_after limit ?3`,
  )
    .bind(at, at + WARNED_BEFORE, WARNED_AT_ONCE)
    .all<{ id: string; email: string; delete_after: number }>()
  for (const one of soon) {
    try {
      if (!(await told(env, one.email, leavingSoonMessage(dayOf(one.delete_after))))) continue
      await env.DB.prepare('update users set delete_warned_at = ? where id = ? and delete_after is not null')
        .bind(at, one.id)
        .run()
    } catch (error) {
      note('leaving', error, null)
    }
  }
}
export const account = new Hono<{ Bindings: Env; Variables: Variables }>()
account.route('/addresses', addresses)
account.post('/delete/code', async (context) => {
  const user = context.get('user')
  if (!(await mayLeave(context.env, user.id))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }
  const sent = await sendCode(context.env, user.email, machineOf(context.req), leavingMessage)
  if ('error' in sent) return refusedMail(context, sent)
  return context.json({
    resendIn: sent.resendIn,
    second: await asksForSecond(context.env, user.id),
    keptDays: KEPT_FOR / A_DAY,
  })
})
account.post('/delete/verify', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 16)
  const second = body.text('second', 64)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!(await mayLeave(context.env, user.id))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }
  const checked = await checkCode(context.env, user.email, code ?? '')
  if ('error' in checked) return context.json({ error: checked.error }, checked.status)
  if (
    (await asksForSecond(context.env, user.id)) &&
    !(await accepted(context.env, user.id, second ?? '', machineOf(context.req)))
  ) {
    return context.json({ error: WRONG_CODE }, 400)
  }
  if (!(await spendCode(context.env, user.email))) {
    return context.json({ error: TOOK_TOO_LONG }, 400)
  }
  const ticket = randomToken()
  await context.env.DB.prepare('insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)')
    .bind(TICKETS, await sha256(ticket), user.id, now() + TICKET_FOR)
    .run()
  return context.json({ ticket })
})
account.delete('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const ticket = body.text('ticket', 128)
  if (body.problem) return context.json({ error: body.problem }, 400)
  const held = ticket
    ? await context.env.DB.prepare(
        'select 1 as one from cached where scope = ? and key = ? and value = ? and until > ?',
      )
        .bind(TICKETS, await sha256(ticket), user.id, now())
        .first<{ one: number }>()
    : null
  if (!held) return context.json({ error: TOOK_TOO_LONG }, 400)
  const deleteAfter = now() + KEPT_FOR
  await context.env.DB.batch([
    context.env.DB.prepare('update users set delete_after = ?, delete_warned_at = null where id = ?').bind(
      deleteAfter,
      user.id,
    ),
    context.env.DB.prepare('insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)').bind(
      LEFT,
      await sha256(ticket ?? ''),
      String(deleteAfter),
      now() + LEFT_FOR,
    ),
    context.env.DB.prepare('delete from cached where scope = ? and value = ?').bind(TICKETS, user.id),
    context.env.DB.prepare('delete from mcp_tokens where user_id = ?').bind(user.id),
    context.env.DB.prepare('delete from oauth_grants where user_id = ?').bind(user.id),
    context.env.DB.prepare('delete from oauth_codes where user_id = ?').bind(user.id),
  ])
  await endEverySession(context.env, user.id)
  try {
    await told(context.env, user.email, leavingSetMessage(dayOf(deleteAfter)))
  } catch (error) {
    note('leaving', error, null)
  }
  return context.json({ ok: true, deleteAfter })
})
export const left = new Hono<{ Bindings: Env; Variables: Variables }>()
left.post('/', async (context) => {
  const body = await readBody(context)
  const ticket = body.text('ticket', 128)
  if (body.problem || !ticket) return context.json({ error: body.problem ?? 'no ticket' }, 400)
  const gone = await context.env.DB.prepare('select value from cached where scope = ? and key = ? and until > ?')
    .bind(LEFT, await sha256(ticket), now())
    .first<{ value: string }>()
  const deleteAfter = Number(gone?.value)
  return context.json({ gone: !!gone, ...(deleteAfter > 0 ? { deleteAfter } : {}) })
})
