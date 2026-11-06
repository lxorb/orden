import { Hono } from 'hono'
import { checkCode, sendCode, spendCode } from './auth'
import { readBody } from './body'
import { now, randomToken, sha256 } from './crypto'
import { leavingMessage, refusedMail } from './email'
import { eraseAccount } from './erase'
import { machineOf, mayLeave } from './limits'
import { TOOK_TOO_LONG, TRY_IN_AN_HOUR, WRONG_CODE } from './refused'
import { accepted, asksForSecond } from './second'
import type { Env, Variables } from './types'

const TICKETS = 'leaving'

const TICKET_FOR = 5 * 60 * 1000

export const account = new Hono<{ Bindings: Env; Variables: Variables }>()

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
  await context.env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
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

  await eraseAccount(context.env, user)

  return context.json({ ok: true })
})
