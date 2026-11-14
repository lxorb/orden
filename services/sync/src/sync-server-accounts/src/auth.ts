import { Hono } from 'hono'
import {
  askHub,
  claimGuest,
  claimGuestsAt,
  codeMessage,
  deviceIn,
  devicesEnded,
  type Env,
  equals,
  forgetEndedTargets,
  guestForToken,
  hooks,
  isEmail,
  machineOf,
  mailCeilings,
  mailer,
  mailNotSent,
  makeFirstSpace,
  mayTryCode,
  newId,
  NOT_AN_EMAIL,
  normaliseEmail,
  now,
  randomCode,
  randomToken,
  readBody,
  refusedMail,
  roomsSignedOut,
  said,
  type Session,
  sha256,
  startingVersion,
  tokenIn,
  TOOK_TOO_LONG,
  TRY_IN_AN_HOUR,
  type User,
  type Variables,
  type Whoever,
  WRONG_CODE,
} from '../../sync-server/src/api'
import { accepted, asksForSecond, halfWay, spendHalf, whoseHalf } from './second'

const CODE_TTL = 10 * 60 * 1000
const RESEND_GAP = 30 * 1000
const MAX_ATTEMPTS = 5
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000

async function userForToken(env: Env, token: string): Promise<User | null> {
  const hash = await sha256(token)

  const row = await env.DB.prepare(
    `select u.id, u.email, u.name, u.created_at, s.last_used_at as seen
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = ? and s.expires_at > ?`,
  )
    .bind(hash, now())
    .first<User & { seen: number | null }>()

  if (!row) return null

  if (!row.seen || now() - row.seen > SEEN_EVERY) {
    await env.DB.prepare('update sessions set last_used_at = ? where token_hash = ?')
      .bind(now(), hash)
      .run()
  }

  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at }
}

const SEEN_EVERY = 60 * 60 * 1000

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

export function accountById(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare('select id, email, name, created_at from users where id = ?')
    .bind(id)
    .first<User>()
}

async function openSession(env: Env, userId: string, device = ''): Promise<string> {
  await env.DB.prepare('delete from sessions where expires_at < ?').bind(now()).run()

  const token = randomToken()
  await env.DB.prepare(
    `insert into sessions (token_hash, user_id, created_at, expires_at, id, name, last_used_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), userId, now(), now() + SESSION_TTL, newId(), device, now())
    .run()

  return token
}

async function accountFor(env: Env, address: string): Promise<User> {
  const held = await env.DB.prepare('select id, email, name, created_at from users where email = ?')
    .bind(address)
    .first<User>()

  if (held) return held

  const user: User = { id: newId(), email: address, name: null, created_at: now() }

  const wrote = await env.DB.prepare(
    `insert into users (id, email, created_at, sync_version) values (?, ?, ?, ?)
     on conflict(email) do nothing`,
  )
    .bind(user.id, user.email, user.created_at, await startingVersion(env))
    .run()

  const account =
    (await env.DB.prepare('select id, email, name, created_at from users where email = ?')
      .bind(address)
      .first<User>()) ?? user

  if (wrote.meta.changes > 0) {
    try {
      await makeFirstSpace(env, account.id)
    } catch {
      // An account is worth more than the note it opens with, so a store that
      // baulks here does not cost somebody their sign-in. Nothing tries again:
      // only an account being made is given a space, because a later sign-in
      // cannot tell an empty rail somebody meant from one that went wrong.
    }
  }

  return account
}

async function claimWhatWasGuested(env: Env, user: User, held: string | null): Promise<void> {
  const guest = held ? await guestForToken(env, held) : null
  if (guest) await claimGuest(env, guest.id, user)

  await claimGuestsAt(env, user)
}

export async function signingIn(
  env: Env,
  address: string,
  held: string | null = null,
): Promise<{ second: true; holding: string } | { user: User }> {
  const user = await accountFor(env, address)
  await claimWhatWasGuested(env, user, held)
  if (await asksForSecond(env, user.id)) return { second: true, holding: await halfWay(env, user) }
  return { user }
}

export async function sessionFor(env: Env, user: User, device = ''): Promise<Session> {
  return { token: await openSession(env, user.id, device), user: presentUser(user) }
}

export async function sendCode(
  env: Env,
  address: string,
  machine: string | null = null,
  message: (code: string) => { subject: string; text: string; html: string } = codeMessage,
): Promise<
  | { ok: true; resendIn: number }
  | { error: string; status: 400 | 429 | 503; retryAfter: number | null }
> {
  if (!isEmail(address)) return { error: NOT_AN_EMAIL, status: 400, retryAfter: null }

  const existing = await env.DB.prepare('select sent_at from login_codes where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (existing && now() - existing.sent_at < RESEND_GAP) {
    return { ok: true, resendIn: Math.ceil((RESEND_GAP - (now() - existing.sent_at)) / 1000) }
  }

  const ceiling = await mailCeilings(env, address, machine)
  if (ceiling) return ceiling

  const code = randomCode()
  const salt = randomToken()

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

  const said = message(code)

  if (!(await mailer(env).send(address, said.subject, said))) {
    await env.DB.prepare('update login_codes set sent_at = 0 where email = ?').bind(address).run()
    await mailNotSent(env, address)

    return { error: 'could not send the mail - try again', status: 503, retryAfter: 5 }
  }

  return { ok: true, resendIn: RESEND_GAP / 1000 }
}

export async function verifyCode(
  env: Env,
  address: string,
  code: string,
): Promise<{ user: User } | { error: string; status: 400 | 429 }> {
  const checked = await checkCode(env, address, code)
  if ('error' in checked) return checked

  if (!(await spendCode(env, address))) return { error: WRONG_CODE, status: 400 }

  return { user: await accountFor(env, address) }
}

export async function checkCode(
  env: Env,
  address: string,
  code: string,
): Promise<{ ok: true } | { error: string; status: 400 | 429 }> {
  const entered = code.replace(/\D/g, '')

  if (!isEmail(address) || entered.length !== 6) {
    return { error: WRONG_CODE, status: 400 }
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

  if (!(await mayTryCode(env, address))) {
    return { error: TRY_IN_AN_HOUR, status: 429 }
  }

  const tried = await env.DB.prepare(
    `update login_codes set attempts = attempts + 1
      where email = ?1 and code_hash = ?2 and attempts < ?3
      returning attempts`,
  )
    .bind(address, pending.code_hash, MAX_ATTEMPTS)
    .first<{ attempts: number }>()
  if (!tried) return { error: 'too many tries - ask for a new code', status: 429 }

  if (!equals(await sha256(pending.salt + entered), pending.code_hash)) {
    return { error: WRONG_CODE, status: 400 }
  }

  return { ok: true }
}

export async function spendCode(env: Env, address: string): Promise<boolean> {
  const spent = await env.DB.prepare('delete from login_codes where email = ?').bind(address).run()
  return !!spent.meta.changes
}

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

const EMAIL_LIMIT = 320
const CODE_LIMIT = 16
const TOKEN_LIMIT = 128

auth.post('/code', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const sent = await sendCode(context.env, normaliseEmail(email ?? ''), machineOf(context.req))

  if ('error' in sent) return refusedMail(context, sent)

  return context.json(sent)
})

auth.post('/verify', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', EMAIL_LIMIT)
  const code = body.text('code', CODE_LIMIT)
  const held = body.text('guest', TOKEN_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const address = normaliseEmail(email ?? '')
  const checked = await checkCode(context.env, address, code ?? '')
  if ('error' in checked) return context.json({ error: checked.error }, checked.status)
  if (!(await spendCode(context.env, address))) return context.json({ error: WRONG_CODE }, 400)

  const signing = await signingIn(context.env, address, held ?? null)
  if ('second' in signing) return context.json(signing)

  return context.json(await sessionFor(context.env, signing.user, deviceOf(context)))
})

function deviceOf(context: { req: { header(name: string): string | undefined } }): string {
  return deviceIn(said((name) => context.req.header(name), 'device'))
}

auth.post('/second', async (context) => {
  const body = await readBody(context)
  const holding = body.text('holding', TOKEN_LIMIT)
  const code = body.text('code', 64)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const whose = holding ? await whoseHalf(context.env, holding) : null
  if (!whose) return context.json({ error: TOOK_TOO_LONG }, 400)

  if (!(await accepted(context.env, whose, code ?? '', machineOf(context.req)))) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  const user = await accountById(context.env, whose)
  if (!user) return context.json({ error: WRONG_CODE }, 400)

  await spendHalf(context.env, holding ?? '')

  return context.json(await sessionFor(context.env, user, deviceOf(context)))
})

export function presentUser(user: User) {
  return { id: user.id, email: user.email, name: user.name }
}

export const sessions = new Hono<{ Bindings: Env; Variables: Variables }>()

sessions.get('/', async (context) => {
  const user = context.get('user')
  const mine = await sha256(tokenIn(context.req.header('authorization')) ?? '')

  const { results } = await context.env.DB.prepare(
    `select id, name, created_at, last_used_at, token_hash from sessions
      where user_id = ? and expires_at > ? order by last_used_at desc, created_at desc`,
  )
    .bind(user.id, now())
    .all<{
      id: string | null
      name: string
      created_at: number
      last_used_at: number | null
      token_hash: string
    }>()

  return context.json({
    sessions: results.map((one) => ({
      id: one.id ?? '',
      name: one.name,
      createdAt: one.created_at,
      lastUsedAt: one.last_used_at,
      current: equals(one.token_hash, mine),
    })),
  })
})

interface Ended {
  id: string | null
  token_hash: string
}

async function sessionsEnded(env: Env, userId: string, ended: readonly Ended[]): Promise<void> {
  if (ended.length) {
    await roomsSignedOut(env, userId)
    const ids = ended.flatMap((one) => (one.id === null ? [] : [one.id]))
    if (ids.length) await devicesEnded(env, userId, ids)
    await hooks().machines.machinesSignedOut(
      env,
      userId,
      ended.map((one) => one.token_hash),
    )
  }
  await forgetEndedTargets(env, userId)
}

sessions.delete('/:id', async (context) => {
  const user = context.get('user')
  const { results: ending } = await context.env.DB.prepare(
    'delete from sessions where user_id = ? and id = ? returning id, token_hash',
  )
    .bind(user.id, context.req.param('id'))
    .all<Ended>()

  await sessionsEnded(context.env, user.id, ending)

  return context.json({ ok: ending.length > 0 })
})

sessions.delete('/', async (context) => {
  const user = context.get('user')
  const mine = await sha256(tokenIn(context.req.header('authorization')) ?? '')

  const { results: ending } = await context.env.DB.prepare(
    'delete from sessions where user_id = ? and token_hash <> ? returning id, token_hash',
  )
    .bind(user.id, mine)
    .all<Ended>()

  await sessionsEnded(context.env, user.id, ending)

  return context.json({ ended: ending.length })
})

auth.post('/signout', async (context) => {
  const token = tokenIn(context.req.header('authorization'))
  if (token) {
    const hash = await sha256(token)
    const held = await context.env.DB.prepare(
      'delete from sessions where token_hash = ? returning user_id, id',
    )
      .bind(hash)
      .first<{ user_id: string; id: string | null }>()

    if (held) {
      await sessionsEnded(context.env, held.user_id, [{ id: held.id, token_hash: hash }])
      return context.json({ ok: true })
    }

    const guest = await context.env.DB.prepare(
      'delete from guest_sessions where token_hash = ? returning guest_id',
    )
      .bind(hash)
      .first<{ guest_id: string }>()
    if (guest) {
      await roomsSignedOut(context.env, guest.guest_id)
      await hooks().machines.machinesSignedOut(context.env, guest.guest_id, [hash])
      await askHub(context.env, guest.guest_id, 'revoke', { 'x-orden-sessions': hash })
    }
  }
  return context.json({ ok: true })
})
