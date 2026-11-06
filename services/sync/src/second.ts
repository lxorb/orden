import { Hono } from 'hono'
import { TOOK_TOO_LONG, WRONG_CODE } from './refused'

import { opened, sealed } from './ask/key'
import { equals, now, randomBytes, randomToken, sha256 } from './crypto'
import { readBody } from './body'
import { rounds } from './rounds'
import { machineOf, mayTrySecond, mayTrySecondFrom } from './limits'
import type { Env, User, Variables } from './types'

const SALT = 'nib/second-factor/v1'

const encoder = new TextEncoder()

const STEP = 30_000
const DIGITS = 6

const DRIFT = 1

const RECOVERY_CODES = 10
const RECOVERY_BYTES = 10

const RECOVERY_VERSION = '2'
export const RECOVERY_ROUNDS = 100_000

export function recoveryCost(): number {
  return rounds(RECOVERY_ROUNDS)
}

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

export function newSecret(): string {
  return [...randomBytes(20)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function otpauth(secretHex: string, email: string): string {
  const secret = base32(fromHex(secretHex))
  const label = encodeURIComponent(`Orden:${email}`)

  return `otpauth://totp/${label}?secret=${secret}&issuer=Orden&algorithm=SHA1&digits=${DIGITS}&period=30`
}

export async function codeAt(secretHex: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    fromHex(secretHex),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setUint32(4, step, false)

  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))

  const at = (signed[19] ?? 0) & 15
  const value =
    (((signed[at] ?? 0) & 0x7f) << 24) |
    ((signed[at + 1] ?? 0) << 16) |
    ((signed[at + 2] ?? 0) << 8) |
    (signed[at + 3] ?? 0)

  return String(value % 10 ** DIGITS).padStart(DIGITS, '0')
}

async function stepMatching(secretHex: string, given: string, at = now()): Promise<number | null> {
  const entered = given.replace(/\D/g, '')
  if (entered.length !== DIGITS) return null

  const step = Math.floor(at / STEP)
  for (let away = -DRIFT; away <= DRIFT; away += 1) {
    if (equals(await codeAt(secretHex, step + away), entered)) return step + away
  }

  return null
}

export async function matches(secretHex: string, given: string, at = now()): Promise<boolean> {
  return (await stepMatching(secretHex, given, at)) !== null
}

async function spendStep(env: Env, userId: string, step: number): Promise<boolean> {
  const written = await env.DB.prepare(
    'update users set totp_step = ? where id = ? and (totp_step is null or totp_step < ?)',
  )
    .bind(step, userId, step)
    .run()

  return !!written.meta.changes
}

export function recoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () =>
    [...randomBytes(RECOVERY_BYTES)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .replace(/(.{5})(?=.)/g, '$1-'),
  )
}

export async function recoveryHash(userId: string, code: string, rounds: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, [
    'deriveBits',
  ])

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(`${SALT}:${userId}`),
      iterations: rounds,
    },
    material,
    256,
  )

  const digest = [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `${RECOVERY_VERSION}.${digest}`
}

async function writeRecovery(env: Env, userId: string): Promise<string[]> {
  const codes = recoveryCodes()

  await env.DB.prepare('delete from recovery_codes where user_id = ?').bind(userId).run()

  for (const code of codes) {
    await env.DB.prepare(
      'insert into recovery_codes (user_id, code_hash, used_at) values (?, ?, null)',
    )
      .bind(userId, await recoveryHash(userId, code, recoveryCost()))
      .run()
  }

  return codes
}

const OWN = 'own:'

function sealingSecret(env: Env): { secret: string; own: boolean } | null {
  if (env.SECOND_FACTOR_SECRET) return { secret: env.SECOND_FACTOR_SECRET, own: true }
  if (env.OPENAI_KEY_SECRET) return { secret: env.OPENAI_KEY_SECRET, own: false }
  return null
}

function mayKeep(env: Env): boolean {
  return sealingSecret(env) !== null
}

async function seal(env: Env, userId: string, secretHex: string): Promise<string | null> {
  const under = sealingSecret(env)
  if (!under) return null

  const made = await sealed(under.secret, userId, secretHex, SALT)
  return under.own ? `${OWN}${made}` : made
}

function unseal(env: Env, userId: string, stored: string): Promise<string | null> {
  const own = stored.startsWith(OWN)
  const secret = own ? env.SECOND_FACTOR_SECRET : env.OPENAI_KEY_SECRET
  if (!secret) return Promise.resolve(null)

  return opened(secret, userId, own ? stored.slice(OWN.length) : stored, SALT)
}

async function reseal(env: Env, userId: string, stored: string, secretHex: string) {
  if (stored.startsWith(OWN) || !env.SECOND_FACTOR_SECRET) return

  const moved = await seal(env, userId, secretHex)
  if (!moved) return

  await env.DB.prepare('update users set totp_secret = ? where id = ? and totp_secret = ?')
    .bind(moved, userId, stored)
    .run()
}

async function secondFor(
  env: Env,
  userId: string,
): Promise<{ secret: string; stored: string } | null> {
  const row = await env.DB.prepare(
    'select totp_secret, totp_at from users where id = ? and totp_at is not null',
  )
    .bind(userId)
    .first<{ totp_secret: string | null; totp_at: number | null }>()

  if (!row?.totp_secret) return null

  const secret = await unseal(env, userId, row.totp_secret)
  return secret === null ? null : { secret, stored: row.totp_secret }
}

const RESEAL_PAGE = 100

export async function resealBorrowed(env: Env): Promise<number> {
  if (!env.SECOND_FACTOR_SECRET || !env.OPENAI_KEY_SECRET) return 0

  let after = ''
  let moved = 0
  for (;;) {
    const { results } = await env.DB.prepare(
      `select id, totp_secret from users
        where totp_secret is not null and totp_secret not like '${OWN}%' and id > ?
        order by id limit ?`,
    )
      .bind(after, RESEAL_PAGE)
      .all<{ id: string; totp_secret: string }>()

    for (const row of results) {
      const secret = await unseal(env, row.id, row.totp_secret)
      if (secret === null) continue

      await reseal(env, row.id, row.totp_secret, secret)
      moved += 1
    }

    const last = results.at(-1)
    if (!last || results.length < RESEAL_PAGE) return moved
    after = last.id
  }
}

export function asksForSecond(env: Env, userId: string): Promise<boolean> {
  return env.DB.prepare('select totp_at from users where id = ? and totp_at is not null')
    .bind(userId)
    .first<{ totp_at: number }>()
    .then((row) => !!row)
}

export async function accepted(
  env: Env,
  userId: string,
  given: string,
  machine: string | null = null,
): Promise<boolean> {
  if (!(await mayTrySecondFrom(env, machine))) return false
  if (!(await mayTrySecond(env, userId))) return false

  const factor = await secondFor(env, userId)
  if (factor) {
    const step = await stepMatching(factor.secret, given)
    if (step !== null) {
      if (!(await spendStep(env, userId, step))) return false

      await reseal(env, userId, factor.stored, factor.secret)
      return true
    }
  }

  const tidied = given.trim().toLowerCase().replace(/\s/g, '')

  const spent = await env.DB.prepare(
    `update recovery_codes set used_at = ?1
      where user_id = ?2 and code_hash in (?3, ?4) and used_at is null`,
  )
    .bind(now(), userId, await recoveryHash(userId, tidied, recoveryCost()), await sha256(tidied))
    .run()

  return !!spent.meta.changes
}

async function turnOn(env: Env, userId: string, secretHex: string): Promise<string[]> {
  const kept = await seal(env, userId, secretHex)
  if (!kept) return []

  await env.DB.prepare(
    'update users set totp_secret = ?, totp_at = ?, totp_step = null where id = ?',
  )
    .bind(kept, now(), userId)
    .run()

  return await writeRecovery(env, userId)
}

export const second = new Hono<{ Bindings: Env; Variables: Variables }>()

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
    possible: mayKeep(context.env),
  })
})

second.post('/', async (context) => {
  if (!mayKeep(context.env)) {
    return context.json({ error: 'this service cannot keep a secret safely' }, 503)
  }

  const user = context.get('user')
  const secret = newSecret()

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

second.post('/confirm', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const holding = body.text('holding', 128)
  const code = body.text('code', 16)
  const current = body.text('current', 64) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!holding || !code) return context.json({ error: WRONG_CODE }, 400)

  const row = await context.env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind('second-pending', await sha256(holding), now())
    .first<{ value: string }>()

  const [whose, secret] = (row?.value ?? '').split(':')
  if (!secret || whose !== user.id) {
    return context.json({ error: TOOK_TOO_LONG }, 400)
  }

  if (!(await matches(secret, code))) return context.json({ error: WRONG_CODE }, 400)

  if (
    (await asksForSecond(context.env, user.id)) &&
    !(await accepted(context.env, user.id, current, machineOf(context.req)))
  ) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  const codes = await turnOn(context.env, user.id, secret)
  await context.env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('second-pending', await sha256(holding))
    .run()

  return context.json({ on: true, recovery: codes })
})

second.delete('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 64) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await accepted(context.env, user.id, code, machineOf(context.req)))) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  await context.env.DB.prepare(
    'update users set totp_secret = null, totp_at = null, totp_step = null where id = ?',
  )
    .bind(user.id)
    .run()

  await context.env.DB.prepare('delete from recovery_codes where user_id = ?').bind(user.id).run()

  return context.json({ on: false })
})

second.post('/recovery', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 64) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await accepted(context.env, user.id, code, machineOf(context.req)))) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  return context.json({ recovery: await writeRecovery(context.env, user.id) })
})

export async function halfWay(env: Env, user: User): Promise<string> {
  const token = randomToken()

  await env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind('second-half', await sha256(token), user.id, now() + 10 * 60 * 1000)
    .run()

  return token
}

export async function whoseHalf(env: Env, token: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind('second-half', await sha256(token), now())
    .first<{ value: string }>()

  return row?.value ?? null
}

export async function spendHalf(env: Env, token: string): Promise<void> {
  await env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind('second-half', await sha256(token))
    .run()
}

export function forgetHalfDone(env: Env, at: number): Promise<unknown> {
  return env.DB.prepare('delete from cached where until < ?').bind(at).run()
}
