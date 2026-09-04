import { Hono } from 'hono'
import { equals, isEmail, newId, normaliseEmail, now, randomCode, randomToken, sha256 } from './crypto'
import { codeMessage, mailer } from './email'
import type { Env, User, Variables } from './types'

const CODE_TTL = 10 * 60 * 1000
const RESEND_GAP = 30 * 1000
const MAX_ATTEMPTS = 5
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000

export async function userForToken(env: Env, token: string): Promise<User | null> {
  const hash = await sha256(token)

  const row = await env.DB.prepare(
    `select u.id, u.email, u.name, u.created_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = ? and s.expires_at > ?`,
  )
    .bind(hash, now())
    .first<User>()

  return row ?? null
}

/** Rejects the request unless it carries a live session. */
export async function requireUser(
  env: Env,
  header: string | undefined,
): Promise<User | null> {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null
  return token ? userForToken(env, token) : null
}

/** Sends a sign-in code, or says how long until another may go. Always
 *  answers the same way for an address it has never seen, so it cannot be
 *  used to discover which addresses have accounts. The OAuth consent page
 *  signs people in with the same code as the app, which is why this is not
 *  written straight into the route. */
export async function sendCode(
  env: Env,
  address: string,
): Promise<{ ok: true; resendIn: number } | { error: string }> {
  if (!isEmail(address)) return { error: 'enter a valid email address' }

  const existing = await env.DB.prepare('select sent_at from login_codes where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (existing && now() - existing.sent_at < RESEND_GAP) {
    return { ok: true, resendIn: Math.ceil((RESEND_GAP - (now() - existing.sent_at)) / 1000) }
  }

  const code = randomCode()
  const salt = randomToken()

  await env.DB.prepare(
    `insert into login_codes (email, code_hash, salt, expires_at, attempts, sent_at)
     values (?, ?, ?, ?, 0, ?)
     on conflict(email) do update set
       code_hash = excluded.code_hash,
       salt = excluded.salt,
       expires_at = excluded.expires_at,
       attempts = 0,
       sent_at = excluded.sent_at`,
  )
    .bind(address, await sha256(salt + code), salt, now() + CODE_TTL, now())
    .run()

  const message = codeMessage(code)
  await mailer(env).send(address, message.subject, message)

  return { ok: true, resendIn: RESEND_GAP / 1000 }
}

/** Checks a code and hands back the account, made on the spot for an address
 *  seen for the first time: signing in and signing up are the same thing. */
export async function verifyCode(
  env: Env,
  address: string,
  code: string,
): Promise<{ user: User } | { error: string; status: 400 | 429 }> {
  const entered = code.replace(/\D/g, '')

  if (!isEmail(address) || entered.length !== 6) {
    return { error: 'that code is not right', status: 400 }
  }

  const pending = await env.DB.prepare(
    'select code_hash, salt, expires_at, attempts from login_codes where email = ?',
  )
    .bind(address)
    .first<{ code_hash: string; salt: string; expires_at: number; attempts: number }>()

  if (!pending || pending.expires_at < now()) {
    return { error: 'that code has expired - ask for a new one', status: 400 }
  }

  if (pending.attempts >= MAX_ATTEMPTS) {
    return { error: 'too many tries - ask for a new code', status: 429 }
  }

  if (!equals(await sha256(pending.salt + entered), pending.code_hash)) {
    await env.DB.prepare('update login_codes set attempts = attempts + 1 where email = ?')
      .bind(address)
      .run()
    return { error: 'that code is not right', status: 400 }
  }

  await env.DB.prepare('delete from login_codes where email = ?').bind(address).run()

  let user = await env.DB.prepare('select id, email, name, created_at from users where email = ?')
    .bind(address)
    .first<User>()

  if (!user) {
    user = { id: newId(), email: address, name: null, created_at: now() }
    await env.DB.prepare('insert into users (id, email, created_at) values (?, ?, ?)')
      .bind(user.id, user.email, user.created_at)
      .run()
  }

  return { user }
}

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Step one. */
auth.post('/code', async (context) => {
  const { email } = await context.req.json<{ email?: string }>()
  const sent = await sendCode(context.env, normaliseEmail(email ?? ''))

  if ('error' in sent) return context.json({ error: sent.error }, 400)
  return context.json(sent)
})

/** Step two. */
auth.post('/verify', async (context) => {
  const { email, code } = await context.req.json<{ email?: string; code?: string }>()
  const verified = await verifyCode(context.env, normaliseEmail(email ?? ''), code ?? '')

  if ('error' in verified) return context.json({ error: verified.error }, verified.status)
  const { user } = verified

  const token = randomToken()
  await context.env.DB.prepare(
    'insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(token), user.id, now(), now() + SESSION_TTL)
    .run()

  return context.json({ token, user: presentUser(user) })
})

/** The account as the app sees it: never the session, never the timestamps. */
export function presentUser(user: User) {
  return { id: user.id, email: user.email, name: user.name }
}

auth.post('/signout', async (context) => {
  const header = context.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (token) {
    await context.env.DB.prepare('delete from sessions where token_hash = ?')
      .bind(await sha256(token))
      .run()
  }
  return context.json({ ok: true })
})
