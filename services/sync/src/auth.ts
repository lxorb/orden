import { Hono } from 'hono'
import { readBody } from './body'
import {
  equals,
  isEmail,
  newId,
  normaliseEmail,
  now,
  randomCode,
  randomToken,
  sha256,
} from './crypto'
import { codeMessage, mailer } from './email'
import { claimGuest, claimGuestsAt, guestForToken } from './guests'
import { makeFirstSpace } from './spaces/first'
import type { Env, User, Variables, Whoever } from './types'

const CODE_TTL = 10 * 60 * 1000
const RESEND_GAP = 30 * 1000
const MAX_ATTEMPTS = 5
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000

async function userForToken(env: Env, token: string): Promise<User | null> {
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

/** The token an `Authorization` header carries, or nothing. The scheme is read
 *  without regard to case, as RFC 7235 says it is written: a client that sends
 *  `bearer` is holding a good session and was being answered 401. */
export function tokenIn(header: string | undefined): string | null {
  const token = /^bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim()
  return token ?? null
}

/** Whoever the request is from: the account whose session it carries, or the
 *  guest a link handed one to. One lookup each, in that order, because an
 *  account's is much the commoner case and either answer is one round trip.
 *
 *  Nothing else answers this question: a route that wants a session gets one of
 *  the two kinds there are and says which it can work with. */
export async function requireWhoever(
  env: Env,
  header: string | undefined,
): Promise<Whoever | null> {
  const token = tokenIn(header)
  if (!token) return null

  const user = await userForToken(env, token)
  if (user) return { kind: 'user', user }

  const guest = await guestForToken(env, token)
  return guest ? { kind: 'guest', guest } : null
}

/** A session for an account, and the row behind it. Sessions that ran out are
 *  cleared as new ones arrive: nothing else would ever take them away, and a
 *  row nobody can use is only a row. */
export async function openSession(env: Env, userId: string): Promise<string> {
  await env.DB.prepare('delete from sessions where expires_at < ?').bind(now()).run()

  const token = randomToken()
  await env.DB.prepare(
    'insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(token), userId, now(), now() + SESSION_TTL)
    .run()

  return token
}

/** The account at an address, made on the spot for one seen for the first time:
 *  signing in and signing up are the same thing, and so is walking through an
 *  invitation written to an address nobody has ever used.
 *
 *  `accepted` is the request's `Accept-Language`, which is the only thing the
 *  service ever learns about what language somebody reads. It is what the first
 *  note is written in, and that note is written once, so the header has to
 *  arrive here rather than be asked for later. */
export async function accountFor(
  env: Env,
  address: string,
  accepted: string | undefined,
): Promise<User> {
  const held = await env.DB.prepare('select id, email, name, created_at from users where email = ?')
    .bind(address)
    .first<User>()

  if (held) return held

  const user: User = { id: newId(), email: address, name: null, created_at: now() }
  await env.DB.prepare('insert into users (id, email, created_at) values (?, ?, ?)')
    .bind(user.id, user.email, user.created_at)
    .run()

  try {
    await makeFirstSpace(env, user.id, accepted)
  } catch {
    // An account is worth more than the note it opens with, so a store that
    // baulks here does not cost somebody their sign-in. Nothing tries again:
    // only an account being made is given a space, because a later sign-in
    // cannot tell an empty rail somebody meant from one that went wrong.
  }

  return user
}

/** Whatever a guest on this device, or a guest at this address, was already in
 *  becomes the account's. Called wherever a session for an account begins, so
 *  that neither way of arriving loses what the person had.
 *
 *  `held` is the guest token the app hands over, which is how the device says
 *  "this was me". Failing to claim is not a failed sign-in: the account is what
 *  was asked for, and a space that did not follow is one the link opens again. */
export async function claimWhatWasGuested(
  env: Env,
  user: User,
  held: string | null,
): Promise<void> {
  const guest = held ? await guestForToken(env, held) : null
  if (guest) await claimGuest(env, guest.id, user)

  await claimGuestsAt(env, user)
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

  // Codes that ran out are cleared as new ones arrive, the way sessions are:
  // nothing else would ever take them away, and a row nobody can use is only a
  // row. One per address that ever started a sign-in and did not finish it adds
  // up, and the table is one anybody can write to.
  await env.DB.prepare('delete from login_codes where expires_at < ?').bind(now()).run()

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
  accepted: string | undefined,
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

  return { user: await accountFor(env, address, accepted) }
}

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

/** What an address and a code may be before either is looked at. The address
 *  is checked properly by `isEmail`; this is only the outer bound, so nothing
 *  absurd reaches a query or a mail. */
const EMAIL_LIMIT = 320
const CODE_LIMIT = 16
/** A session token, as the outer bound on the guest one a sign-in hands over. */
const TOKEN_LIMIT = 128

/** Step one. */
auth.post('/code', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const sent = await sendCode(context.env, normaliseEmail(email ?? ''))

  if ('error' in sent) return context.json({ error: sent.error }, 400)
  return context.json(sent)
})

/** Step two. */
auth.post('/verify', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  const code = body.text('code', CODE_LIMIT)
  // What this device was as a guest, if it was one. Handed over so that the
  // spaces a link let it into follow it into the account.
  const held = body.text('guest', TOKEN_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const verified = await verifyCode(
    context.env,
    normaliseEmail(email ?? ''),
    code ?? '',
    context.req.header('accept-language'),
  )

  if ('error' in verified) return context.json({ error: verified.error }, verified.status)
  const { user } = verified

  await claimWhatWasGuested(context.env, user, held ?? null)

  return context.json({ token: await openSession(context.env, user.id), user: presentUser(user) })
})

/** The account as the app sees it: never the session, never the timestamps. */
export function presentUser(user: User) {
  return { id: user.id, email: user.email, name: user.name }
}

auth.post('/signout', async (context) => {
  const token = tokenIn(context.req.header('authorization'))
  if (token) {
    await context.env.DB.prepare('delete from sessions where token_hash = ?')
      .bind(await sha256(token))
      .run()
  }
  return context.json({ ok: true })
})
