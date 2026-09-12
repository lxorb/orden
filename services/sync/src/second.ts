/** The second factor: a code from an authenticator app.
 *
 *  Signing in to nib is an emailed code, so whoever holds the mailbox holds the
 *  account. That is fine for almost everybody and not fine for two cases worth
 *  taking seriously: a mailbox that has been taken over, and one left signed in
 *  on a machine somebody else uses. A second factor is exactly the answer to
 *  those, and to nothing else.
 *
 *  Why TOTP rather than passkeys, which are stronger and nicer: a passkey is
 *  bound to one origin, and nib runs at `tauri://localhost` on the desktop, at
 *  `http://127.0.0.1:<a fresh port every launch>` inside the glasses plugin, and
 *  at its own domain on the web. There is no single relying party those three can
 *  agree on, so a passkey would work on the web and refuse to exist on the other
 *  two - which is not a second factor, it is a second class of reader. Six digits
 *  work everywhere, need no new dependency, and are the thing every authenticator
 *  app already does. See docs/sync.md, which says this out loud.
 *
 *  How it is kept: the secret is encrypted under the environment's own secret,
 *  the way the OpenAI key is (see ask/key.ts) and with a derivation of its own,
 *  so a leaked database is not a drawer full of working authenticators. No
 *  secret configured means no second factor rather than one stored in the clear.
 *
 *  Recovery codes are ten one-shot words, hashed at rest and spent the moment
 *  they work, which is how every other one-shot secret here behaves. Losing a
 *  phone is the common case and the only honest way out of it. */

import { Hono } from 'hono'

import { opened, sealed } from './ask/key'
import { equals, now, randomBytes, randomToken, sha256 } from './crypto'
import { readBody } from './body'
import { mayTrySecond } from './limits'
import type { Env, User, Variables } from './types'

/** This derivation, which is not the one the OpenAI key uses. */
const SALT = 'nib/second-factor/v1'

/** Thirty seconds a step, six digits, SHA-1: what every authenticator app
 *  implements, and none of it is ours to choose. */
const STEP = 30_000
const DIGITS = 6

/** How far out of step a clock may be. One step either side is what every other
 *  implementation allows, and it is the difference between a phone that is a few
 *  seconds slow working and looking broken. */
const DRIFT = 1

/** How many one-shot codes are handed out, and how long each is. */
const RECOVERY_CODES = 10
const RECOVERY_BYTES = 5

/** RFC 4648 base32, unpadded, which is the only way an authenticator app takes a
 *  secret. Written here because the codebase has no codec for it and it is
 *  twenty lines. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32(raw: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of raw) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }

  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31)

  return out
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let at = 0; at < out.length; at += 1) {
    out[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16)
  }

  return out
}

/** A fresh secret, as hex. Hex on the way in and base32 on the way out to the
 *  reader: one shape to store and one shape to type into a phone. */
export function newSecret(): string {
  return [...randomBytes(20)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What the app shows for somebody to scan or paste. The label is what an
 *  authenticator app lists it under. */
export function otpauth(secretHex: string, email: string): string {
  const secret = base32(fromHex(secretHex))
  const label = encodeURIComponent(`nib:${email}`)

  return `otpauth://totp/${label}?secret=${secret}&issuer=nib&algorithm=SHA1&digits=${DIGITS}&period=30`
}

/** The code a secret stands at, for one step. */
export async function codeAt(secretHex: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    fromHex(secretHex),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  // The counter is eight bytes, big endian. A step fits in the low four for the
  // next several thousand years, and the high four are written anyway because
  // that is what the standard says is sent.
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setUint32(4, step, false)

  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))

  // Dynamic truncation: the low nibble of the last byte says where to read the
  // four bytes that become the number.
  const at = (signed[19] ?? 0) & 15
  const value =
    (((signed[at] ?? 0) & 0x7f) << 24) |
    ((signed[at + 1] ?? 0) << 16) |
    ((signed[at + 2] ?? 0) << 8) |
    (signed[at + 3] ?? 0)

  return String(value % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Whether a code is this secret's, now or one step either side. */
export async function matches(secretHex: string, given: string, at = now()): Promise<boolean> {
  const entered = given.replace(/\D/g, '')
  if (entered.length !== DIGITS) return false

  const step = Math.floor(at / STEP)
  for (let away = -DRIFT; away <= DRIFT; away += 1) {
    if (equals(await codeAt(secretHex, step + away), entered)) return true
  }

  return false
}

/** Ten one-shot codes, in the shape somebody can read off a screen and type. */
export function recoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () =>
    [...randomBytes(RECOVERY_BYTES)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .replace(/(.{5})/, '$1-'),
  )
}

/** Whether this account has a second factor, and the secret when it has one.
 *  Null for an account with none, and for one whose secret will not open - which
 *  is the same answer, because a factor nobody can verify is not one. */
async function secondFor(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'select totp_secret, totp_at from users where id = ? and totp_at is not null',
  )
    .bind(userId)
    .first<{ totp_secret: string | null; totp_at: number | null }>()

  if (!row?.totp_secret || !env.OPENAI_KEY_SECRET) return null

  return await opened(env.OPENAI_KEY_SECRET, userId, row.totp_secret, SALT)
}

/** Whether the account asks for a second factor at all. Asked before the secret
 *  is opened, because the sign-in needs to know before it knows who is asking. */
export function asksForSecond(env: Env, userId: string): Promise<boolean> {
  return env.DB.prepare('select totp_at from users where id = ? and totp_at is not null')
    .bind(userId)
    .first<{ totp_at: number }>()
    .then((row) => !!row)
}

/** One code, checked against the factor and then against the recovery codes.
 *
 *  A recovery code is spent the moment it works. Ceilinged per account: six
 *  digits is a million guesses and a script with an hour would otherwise walk
 *  them. */
export async function accepted(env: Env, userId: string, given: string): Promise<boolean> {
  if (!(await mayTrySecond(env, userId))) return false

  const secret = await secondFor(env, userId)
  if (secret && (await matches(secret, given))) return true

  const tidied = given.trim().toLowerCase().replace(/\s/g, '')
  const hash = await sha256(tidied)

  const spent = await env.DB.prepare(
    'update recovery_codes set used_at = ? where user_id = ? and code_hash = ? and used_at is null',
  )
    .bind(now(), userId, hash)
    .run()

  return !!spent.meta.changes
}

/** Turns it on for an account, and hands back the codes that get somebody in
 *  when the phone is gone. Replaces whatever was there: turning it on twice is
 *  two secrets and one of them would be a way in nobody remembers. */
async function turnOn(env: Env, userId: string, secretHex: string): Promise<string[]> {
  if (!env.OPENAI_KEY_SECRET) return []

  const codes = recoveryCodes()

  await env.DB.prepare('update users set totp_secret = ?, totp_at = ? where id = ?')
    .bind(await sealed(env.OPENAI_KEY_SECRET, userId, secretHex, SALT), now(), userId)
    .run()

  await env.DB.prepare('delete from recovery_codes where user_id = ?').bind(userId).run()

  for (const code of codes) {
    await env.DB.prepare(
      'insert into recovery_codes (user_id, code_hash, used_at) values (?, ?, null)',
    )
      .bind(userId, await sha256(code))
      .run()
  }

  return codes
}

export const second = new Hono<{ Bindings: Env; Variables: Variables }>()

/** What the pane shows: whether it is on, and how many recovery codes are left. */
second.get('/', async (context) => {
  const user = context.get('user')
  const row = await context.env.DB.prepare('select totp_at from users where id = ?')
    .bind(user.id)
    .first<{ totp_at: number | null }>()

  const left = await context.env.DB.prepare(
    'select count(*) as spare from recovery_codes where user_id = ? and used_at is null',
  )
    .bind(user.id)
    .first<{ spare: number }>()

  return context.json({
    on: !!row?.totp_at,
    since: row?.totp_at ?? null,
    codesLeft: left?.spare ?? 0,
    // Without the environment's secret there is nowhere safe to keep a secret,
    // so the pane offers nothing rather than offering something that would be
    // stored in the clear.
    possible: !!context.env.OPENAI_KEY_SECRET,
  })
})

/** Step one of turning it on: a secret to put into an authenticator app.
 *
 *  Nothing is switched on here. The secret comes back, is shown once, and is only
 *  written to the account by the confirm below - so somebody who never finishes
 *  is not locked out of their own account by a factor they cannot answer. */
second.post('/', async (context) => {
  if (!context.env.OPENAI_KEY_SECRET) {
    return context.json({ error: 'this service cannot keep a secret safely' }, 503)
  }

  const user = context.get('user')
  const secret = newSecret()

  // Held for ten minutes under the token the confirm sends back, in the table
  // that exists for exactly this: something answered once and kept a while.
  const holding = randomToken()
  await context.env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind('second-pending', await sha256(holding), `${user.id}:${secret}`, now() + 10 * 60 * 1000)
    .run()

  return context.json({
    holding,
    secret: base32(fromHex(secret)),
    uri: otpauth(secret, user.email),
  })
})

/** Step two: the first code out of the app, which proves it was set up, and the
 *  recovery codes, which are shown once and never again. */
second.post('/confirm', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const holding = body.text('holding', 128)
  const code = body.text('code', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!holding || !code) return context.json({ error: 'that code is not right' }, 400)

  const row = await context.env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind('second-pending', await sha256(holding), now())
    .first<{ value: string }>()

  const [whose, secret] = (row?.value ?? '').split(':')
  if (!secret || whose !== user.id) {
    return context.json({ error: 'start again - that took too long' }, 400)
  }

  if (!(await matches(secret, code))) return context.json({ error: 'that code is not right' }, 400)

  const codes = await turnOn(context.env, user.id, secret)
  await context.env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('second-pending', await sha256(holding))
    .run()

  return context.json({ on: true, recovery: codes })
})

/** Turns it off, which takes a code: somebody who has the session but not the
 *  phone is exactly who a second factor is there to stop. */
second.delete('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 64) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await accepted(context.env, user.id, code))) {
    return context.json({ error: 'that code is not right' }, 400)
  }

  await context.env.DB.prepare('update users set totp_secret = null, totp_at = null where id = ?')
    .bind(user.id)
    .run()

  await context.env.DB.prepare('delete from recovery_codes where user_id = ?').bind(user.id).run()

  return context.json({ on: false })
})

/** Fresh recovery codes, for somebody who has used most of theirs or thinks a
 *  list has been seen. The old ones stop working. */
second.post('/recovery', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 64) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await accepted(context.env, user.id, code))) {
    return context.json({ error: 'that code is not right' }, 400)
  }

  const codes = recoveryCodes()
  await context.env.DB.prepare('delete from recovery_codes where user_id = ?').bind(user.id).run()

  for (const one of codes) {
    await context.env.DB.prepare(
      'insert into recovery_codes (user_id, code_hash, used_at) values (?, ?, null)',
    )
      .bind(user.id, await sha256(one))
      .run()
  }

  return context.json({ recovery: codes })
})

/** What a sign-in holds between the emailed code and the second one.
 *
 *  Kept in the same table as everything else answered once and held a while, for
 *  ten minutes: long enough to find a phone, short enough that a half-finished
 *  sign-in on a shared machine is not a way in tomorrow. */
export async function halfWay(env: Env, user: User): Promise<string> {
  const token = randomToken()

  await env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind('second-half', await sha256(token), user.id, now() + 10 * 60 * 1000)
    .run()

  return token
}

/** Whose half-finished sign-in this is, and it is spent: a token that has been
 *  answered cannot be answered again. */
export async function whoseHalf(env: Env, token: string): Promise<string | null> {
  const hash = await sha256(token)
  const row = await env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind('second-half', hash, now())
    .first<{ value: string }>()

  if (!row) return null

  await env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('second-half', hash)
    .run()

  return row.value
}
