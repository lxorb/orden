import { Hono } from 'hono'
import {
  addressMessage,
  addressMovedMessage,
  type Env,
  escape,
  isEmail,
  machineOf,
  mailer,
  movedAddress,
  normaliseEmail,
  NOT_AN_EMAIL,
  now,
  randomToken,
  readBody,
  refusedMail,
  sha256,
  TOOK_TOO_LONG,
  TRY_IN_AN_HOUR,
  type User,
  type Variables,
  within,
  WRONG_CODE,
} from '../../sync-server/src/api'
import { checkCode, sendCode, spendCode } from './auth'
import { accepted, asksForSecond } from './second'

const TAKEN = 'that address belongs to another account'
const YOURS = 'that address is already yours'
const LONGEST_ADDRESS = 254

const UNDO = 'address-undo'
const UNDO_FOR = 7 * 24 * 60 * 60 * 1000

const CODES_AN_HOUR = 10
const AN_HOUR = 60 * 60 * 1000

function isTaken(error: unknown): boolean {
  return /address taken|UNIQUE constraint failed/.test(String(error))
}

async function secondOf(env: Env, userId: string): Promise<string | null> {
  const held = await env.DB.prepare('select email from user_addresses where user_id = ?')
    .bind(userId)
    .first<{ email: string }>()
  return held?.email ?? null
}

async function takenBy(env: Env, email: string, userId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select 1 as one from users where email = ?1 and id <> ?2
     union all
     select 1 from user_addresses where email = ?1 and user_id <> ?2
     limit 1`,
  )
    .bind(email, userId)
    .first()
  return !!held
}

async function shown(env: Env, userId: string) {
  const user = await env.DB.prepare('select email from users where id = ?').bind(userId).first<{ email: string }>()
  return { email: user?.email ?? '', second: await secondOf(env, userId) }
}

function asPrimary(env: Env, userId: string, from: string, to: string, keep: boolean) {
  return env.DB.batch([
    env.DB.prepare('delete from user_addresses where user_id = ? and email = ?').bind(userId, to),
    env.DB.prepare('update users set email = ?3 where id = ?1 and email = ?2').bind(userId, from, to),
    ...(keep
      ? [
          env.DB.prepare('insert into user_addresses (email, user_id, created_at) values (?, ?, ?)').bind(
            from,
            userId,
            now(),
          ),
        ]
      : []),
    ...movedAddress(env, from, to),
  ])
}

async function moved(env: Env, user: User, to: string, keep: boolean): Promise<void> {
  await asPrimary(env, user.id, user.email, to, keep)

  const token = randomToken()
  await env.DB.prepare('insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)')
    .bind(UNDO, await sha256(token), `${user.id}:${user.email}:${to}`, now() + UNDO_FOR)
    .run()
  const said = addressMovedMessage(to, `${env.APP_ORIGIN}/v1/account/undo/${token}`)
  await mailer(env).send(user.email, said.subject, said)
}

export const addresses = new Hono<{ Bindings: Env; Variables: Variables }>()

addresses.get('/', async (context) => {
  return context.json(await shown(context.env, context.get('user').id))
})

addresses.post('/code', async (context) => {
  const user = context.get('user')
  const env = context.env
  const body = await readBody(context)
  const email = normaliseEmail(body.text('email', LONGEST_ADDRESS) ?? '')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)

  if (email === user.email || email === (await secondOf(env, user.id))) {
    return context.json({ error: YOURS }, 409)
  }
  if (await takenBy(env, email, user.id)) return context.json({ error: TAKEN }, 409)
  if (!(await within(env, 'address-code', user.id, CODES_AN_HOUR, AN_HOUR))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }

  const sent = await sendCode(env, email, machineOf(context.req), addressMessage)
  if ('error' in sent) return refusedMail(context, sent)

  return context.json({ resendIn: sent.resendIn, second: await asksForSecond(env, user.id) })
})

addresses.post('/', async (context) => {
  const user = context.get('user')
  const env = context.env
  const body = await readBody(context)
  const email = normaliseEmail(body.text('email', LONGEST_ADDRESS) ?? '')
  const code = body.text('code', 16) ?? ''
  const second = body.text('second', 64) ?? ''
  const as = body.text('as', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  if (as !== 'primary' && as !== 'second') {
    return context.json({ error: 'say primary or second' }, 400)
  }
  if (email === user.email) return context.json({ error: YOURS }, 409)

  const checked = await checkCode(env, email, code)
  if ('error' in checked) return context.json({ error: checked.error }, checked.status)
  if ((await asksForSecond(env, user.id)) && !(await accepted(env, user.id, second, machineOf(context.req)))) {
    return context.json({ error: WRONG_CODE }, 400)
  }
  if (!(await spendCode(env, email))) return context.json({ error: TOOK_TOO_LONG }, 400)

  try {
    if (as === 'primary') await moved(env, user, email, false)
    else {
      await env.DB.batch([
        env.DB.prepare('delete from user_addresses where user_id = ?').bind(user.id),
        env.DB.prepare('insert into user_addresses (email, user_id, created_at) values (?, ?, ?)').bind(
          email,
          user.id,
          now(),
        ),
        ...movedAddress(env, email, user.email),
      ])
    }
  } catch (error) {
    if (isTaken(error)) return context.json({ error: TAKEN }, 409)
    throw error
  }

  return context.json(await shown(env, user.id))
})

addresses.post('/second/primary', async (context) => {
  const user = context.get('user')
  const second = await secondOf(context.env, user.id)
  if (!second) return context.json({ error: 'there is no second address' }, 404)

  await moved(context.env, user, second, true)
  return context.json(await shown(context.env, user.id))
})

addresses.delete('/second', async (context) => {
  const user = context.get('user')
  await context.env.DB.prepare('delete from user_addresses where user_id = ?').bind(user.id).run()
  return context.json(await shown(context.env, user.id))
})

export const addressUndo = new Hono<{ Bindings: Env }>()

function page(said: string, form = false): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Orden</title>
<body style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23;max-width:32rem;margin:4rem auto;padding:0 16px">
<p>${escape(said)}</p>${
    form
      ? '<form method="post"><button style="padding:10px 18px;border-radius:9px;border:none;background:#5b4be0;color:#fff;font-weight:600">Put my address back</button></form>'
      : ''
  }</body>`
}

async function undoFor(env: Env, token: string) {
  const held = await env.DB.prepare('select value from cached where scope = ? and key = ? and until > ?')
    .bind(UNDO, await sha256(token), now())
    .first<{ value: string }>()
  const [userId, was, to] = held?.value.split(':') ?? []
  return userId && was && to ? { userId, was, to } : null
}

addressUndo.get('/:token', async (context) => {
  const undo = await undoFor(context.env, context.req.param('token'))
  return context.html(
    undo
      ? page(`Your Orden account was moved from ${undo.was} to ${undo.to}.`, true)
      : page('This link has expired or was already used.'),
    undo ? 200 : 404,
    { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  )
})

addressUndo.post('/:token', async (context) => {
  const env = context.env
  const token = context.req.param('token')
  const undo = await undoFor(env, token)
  if (!undo) return context.html(page('This link has expired or was already used.'), 404)
  const current = await env.DB.prepare('select email from users where id = ?')
    .bind(undo.userId)
    .first<{ email: string }>()
  if (current?.email !== undo.to) {
    return context.html(page('The address of this account has changed again since.'), 409)
  }

  try {
    await asPrimary(env, undo.userId, undo.to, undo.was, false)
  } catch (error) {
    if (!isTaken(error)) throw error
    return context.html(page(`${undo.was} belongs to another account now.`), 409)
  }
  await env.DB.batch([
    env.DB.prepare('delete from cached where scope = ? and key = ?').bind(UNDO, await sha256(token)),
    env.DB.prepare('delete from sessions where user_id = ?').bind(undo.userId),
  ])
  return context.html(page(`Your Orden account signs in with ${undo.was} again. Every device was signed out.`))
})
