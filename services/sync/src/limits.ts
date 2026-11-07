import { now } from './crypto'
import { TRY_IN_AN_HOUR } from './refused'
import type { Env } from './types'

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

const MAIL_FROM_ONE_MACHINE = 20

const ADDRESSES_A_DAY = 500

export function machineOf(headers: { header(name: string): string | undefined }): string | null {
  const said = headers.header('cf-connecting-ip')?.trim()
  return said && said.length <= 64 ? said : null
}

async function counted(env: Env, scope: string, key: string, window: number): Promise<number> {
  await env.DB.prepare('delete from limits where until < ?').bind(now()).run()

  const row = await env.DB.prepare(
    `insert into limits (scope, key, count, until) values (?1, ?2, 1, ?3)
     on conflict(scope, key) do update set count = limits.count + 1
     returning count`,
  )
    .bind(scope, key, now() + window)
    .first<{ count: number }>()

  return row?.count ?? 1
}

export async function within(
  env: Env,
  scope: string,
  key: string,
  most: number,
  window: number,
): Promise<boolean> {
  return (await counted(env, scope, key, window)) <= most
}

async function uncount(env: Env, scope: string, key: string): Promise<void> {
  await env.DB.prepare(
    'update limits set count = count - 1 where scope = ? and key = ? and count > 0',
  )
    .bind(scope, key)
    .run()
}

async function withinTheDay(env: Env, address: string): Promise<boolean> {
  const day = Math.floor(now() / A_DAY)

  await env.DB.prepare('delete from mailed_days where day < ?').bind(day).run()

  const counted = await env.DB.prepare(
    `select count(*) as many, sum(case when email = ?2 then 1 else 0 end) as held
       from mailed_days where day = ?1`,
  )
    .bind(day, address)
    .first<{ many: number; held: number | null }>()

  if (!counted?.held && (counted?.many ?? 0) >= ADDRESSES_A_DAY) return false

  await env.DB.prepare('insert into mailed_days (day, email) values (?, ?) on conflict do nothing')
    .bind(day, address)
    .run()

  return true
}

const REGISTRATIONS_AN_HOUR = 20

export function mayRegister(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'register', machine, REGISTRATIONS_AN_HOUR, AN_HOUR)
}

export function mayTellTheOwner(env: Env, spaceId: string): Promise<boolean> {
  return within(env, 'waiting', spaceId, 1, AN_HOUR)
}

const QUESTIONS_AN_HOUR = 60
const UTTERANCES_AN_HOUR = 600

export function mayAsk(env: Env, userId: string): Promise<boolean> {
  return within(env, 'ask', userId, QUESTIONS_AN_HOUR, AN_HOUR)
}

export function mayTranscribe(env: Env, userId: string): Promise<boolean> {
  return within(env, 'said', userId, UTTERANCES_AN_HOUR, AN_HOUR)
}

const SECOND_TRIES_AN_HOUR = 20

export function mayTrySecond(env: Env, userId: string): Promise<boolean> {
  return within(env, 'second', userId, SECOND_TRIES_AN_HOUR, AN_HOUR)
}

const SECOND_TRIES_FROM_ONE_MACHINE = 60

export function mayTrySecondFrom(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'second-from', machine, SECOND_TRIES_FROM_ONE_MACHINE, AN_HOUR)
}

const CODE_TRIES_AN_HOUR = 15

export function mayTryCode(env: Env, address: string): Promise<boolean> {
  return within(env, 'code-tries', address, CODE_TRIES_AN_HOUR, AN_HOUR)
}

const LEAVING_AN_HOUR = 10

export function mayLeave(env: Env, userId: string): Promise<boolean> {
  return within(env, 'leaving', userId, LEAVING_AN_HOUR, AN_HOUR)
}

const ANSWERS_FROM_ONE_MACHINE = 10
const ANSWERS_TO_ONE_SITE = 200

export function maySendAnswer(env: Env, machine: string | null): Promise<boolean> {
  if (!machine) return Promise.resolve(true)
  return within(env, 'answer-from', machine, ANSWERS_FROM_ONE_MACHINE, AN_HOUR)
}

export function mayTakeAnswer(env: Env, spaceId: string): Promise<boolean> {
  return within(env, 'answers', spaceId, ANSWERS_TO_ONE_SITE, AN_HOUR)
}

const GUESSES_FROM_ONE_MACHINE = 20
const GUESSES_AT_ONE_SITE = 500

export async function mayGuess(
  env: Env,
  spaceId: string,
  machine: string | null,
): Promise<boolean> {
  if (!(await within(env, 'guesses', spaceId, GUESSES_AT_ONE_SITE, AN_HOUR))) return false
  if (!machine) return true

  return within(env, 'guess-from', `${spaceId}:${machine}`, GUESSES_FROM_ONE_MACHINE, AN_HOUR)
}

const A_MINUTE = 60 * 1000

const TREE_CHANGES_A_MINUTE = 600
const DOCUMENT_PUSHES_A_MINUTE = 600

export function mayChangeTree(env: Env, whoId: string): Promise<boolean> {
  return within(env, 'tree-ops', whoId, TREE_CHANGES_A_MINUTE, A_MINUTE)
}

export function mayPushDocuments(env: Env, whoId: string): Promise<boolean> {
  return within(env, 'doc-push', whoId, DOCUMENT_PUSHES_A_MINUTE, A_MINUTE)
}

const PASS_ITEM_WRITES_A_MINUTE = 600

export function mayWritePassItems(env: Env, userId: string): Promise<boolean> {
  return within(env, 'pass-items', userId, PASS_ITEM_WRITES_A_MINUTE, A_MINUTE)
}

const PASS_INVITES_AN_HOUR = 100

export function mayInviteToPass(env: Env, userId: string): Promise<boolean> {
  return within(env, 'pass-invites', userId, PASS_INVITES_AN_HOUR, AN_HOUR)
}

const KEEPS_AN_HOUR = 200

export function mayKeepVersions(env: Env, whoId: string): Promise<boolean> {
  return within(env, 'doc-keep', whoId, KEEPS_AN_HOUR, AN_HOUR)
}

const MAIL_TO_ONE_ADDRESS_AN_HOUR = 6
const MAIL_TO_ONE_ADDRESS_A_DAY = 24

const MAIL_A_DAY = 900

const SENT = 'mail-sent'

function thisHour(): string {
  return String(Math.floor(now() / AN_HOUR))
}

async function mailRunsOutFor(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `select coalesce(sum(count), 0) as sent, min(until) as first
       from limits where scope = ? and until >= ? and count > 0`,
  )
    .bind(SENT, now())
    .first<{ sent: number; first: number | null }>()

  if (!row || row.sent < MAIL_A_DAY) return null

  return Math.max(1, Math.ceil(((row.first ?? now()) - now()) / 1000))
}

const TOO_MUCH_TODAY = 'too much mail today - try again tomorrow'

export interface MailRefusal {
  error: string
  status: 429 | 503
  retryAfter: number | null
  aboutTheAddress: boolean
}

export async function mailCeilings(
  env: Env,
  address: string,
  machine: string | null,
): Promise<MailRefusal | null> {
  const wait = await mailRunsOutFor(env)
  if (wait !== null) {
    return { error: TOO_MUCH_TODAY, status: 503, retryAfter: wait, aboutTheAddress: false }
  }

  if (machine && !(await within(env, 'mail', machine, MAIL_FROM_ONE_MACHINE, AN_HOUR))) {
    return {
      error: 'too many messages from here - try again later',
      status: 429,
      retryAfter: null,
      aboutTheAddress: false,
    }
  }

  if (!(await withinTheDay(env, address))) {
    return { error: TOO_MUCH_TODAY, status: 429, retryAfter: null, aboutTheAddress: false }
  }

  if (!(await within(env, 'mail-to', address, MAIL_TO_ONE_ADDRESS_AN_HOUR, AN_HOUR))) {
    return { error: TRY_IN_AN_HOUR, status: 429, retryAfter: null, aboutTheAddress: true }
  }

  if (!(await within(env, 'mail-to-day', address, MAIL_TO_ONE_ADDRESS_A_DAY, A_DAY))) {
    return { error: TOO_MUCH_TODAY, status: 429, retryAfter: null, aboutTheAddress: true }
  }

  await counted(env, SENT, thisHour(), A_DAY)
  return null
}

export async function mailNotSent(env: Env, address: string): Promise<void> {
  await uncount(env, 'mail-to', address)
  await uncount(env, 'mail-to-day', address)
  await uncount(env, SENT, thisHour())
}
