import type { tl } from '@mtcute/core'
import type { Host, Prompt } from '../provider'
import { errorText, type Client, type SentCode } from './client'

const TRIES = 5

export const WORDS = {
  code: 'Telegram code',
  app: 'Sent to Telegram on your other device',
  sms: 'Sent by SMS',
  call: 'You will get a call with the code',
  wrongCode: 'The code was wrong. Try again.',
  expired: 'The code expired, so Telegram sent a new one.',
  password: 'Two-step verification password',
  wrongPassword: 'The password was wrong. Try again.',
  scan: 'Scan with Telegram on your phone',
  where: 'Telegram > Settings > Devices > Link Desktop Device',
  needsApp: 'Signing in to Telegram needs the app',
  badPhone: 'Telegram does not know this phone number',
  tooMany: 'Too many tries. Wait a while and try again.',
  gaveUp: 'Too many wrong tries',
} as const

function noteOf(sent: SentCode): string {
  return sent.via === 'app'
    ? WORDS.app
    : sent.via === 'sms'
      ? WORDS.sms
      : sent.via === 'call'
        ? WORDS.call
        : WORDS.sms
}

function friendly(error: unknown): Error {
  const text = errorText(error)
  if (text.startsWith('FLOOD_WAIT') || text === 'PHONE_NUMBER_FLOOD')
    return new Error(WORDS.tooMany)
  if (text === 'PHONE_NUMBER_INVALID' || text === 'PHONE_NUMBER_BANNED')
    return new Error(WORDS.badPhone)
  return error instanceof Error ? error : new Error(text)
}

async function password(
  client: Client,
  ask: (prompt: Prompt) => Promise<string>,
): Promise<tl.RawUser> {
  const hint = await client.hint().catch(() => null)
  let wrong = false
  for (let tries = 0; tries < TRIES; tries++) {
    const prompt: Prompt = { kind: 'password', label: WORDS.password }
    const note = wrong ? WORDS.wrongPassword : hint
    if (note) prompt.note = note
    const given = await ask(prompt)
    try {
      return await client.checkPassword(given)
    } catch (error) {
      if (errorText(error) !== 'PASSWORD_HASH_INVALID') throw friendly(error)
      wrong = true
    }
  }
  throw new Error(WORDS.gaveUp)
}

async function byPhone(
  client: Client,
  phone: string,
  ask: (prompt: Prompt) => Promise<string>,
): Promise<tl.RawUser> {
  const first = await client.sendCode(phone).catch((error: unknown) => {
    throw friendly(error)
  })
  if (!('hash' in first)) return first
  let sent: SentCode = first
  let note: string = noteOf(sent)
  for (let tries = 0; tries < TRIES; tries++) {
    const code = (await ask({ kind: 'code', label: WORDS.code, note })).replace(/\D/g, '')
    try {
      return await client.signIn(phone, sent.hash, code)
    } catch (error) {
      const text = errorText(error)
      if (text === 'SESSION_PASSWORD_NEEDED') return password(client, ask)
      if (text === 'PHONE_CODE_INVALID' || text === 'PHONE_CODE_EMPTY') {
        note = WORDS.wrongCode
        continue
      }
      if (text === 'PHONE_CODE_EXPIRED') {
        const again = await client.sendCode(phone).catch((failed: unknown) => {
          throw friendly(failed)
        })
        if (!('hash' in again)) return again
        sent = again
        note = WORDS.expired
        continue
      }
      throw friendly(error)
    }
  }
  throw new Error(WORDS.gaveUp)
}

async function byQr(
  client: Client,
  host: Host,
  ask: (prompt: Prompt) => Promise<string>,
): Promise<tl.RawUser> {
  const show = host.show
  if (!show) throw new Error(WORDS.needsApp)
  let wrong = false
  try {
    return await client.signInQr(
      (url) => show({ kind: 'qr', data: url, label: WORDS.scan, note: WORDS.where }),
      async () => {
        show(null)
        const hint = await client.hint().catch(() => null)
        const prompt: Prompt = { kind: 'password', label: WORDS.password }
        const note = wrong ? WORDS.wrongPassword : hint
        if (note) prompt.note = note
        return ask(prompt)
      },
      () => {
        wrong = true
      },
    )
  } catch (error) {
    throw friendly(error)
  } finally {
    show(null)
  }
}

function phoneOf(value: string | undefined): string {
  const digits = (value ?? '').replace(/[^\d+]/g, '')
  if (!digits) return ''
  return digits.startsWith('+')
    ? digits
    : digits.startsWith('00')
      ? `+${digits.slice(2)}`
      : `+${digits}`
}

export async function signIn(
  client: Client,
  config: Readonly<Record<string, string>>,
  host: Host,
): Promise<tl.RawUser> {
  const ask = host.ask
  if (!ask) throw new Error(WORDS.needsApp)
  const phone = phoneOf(config.phone)
  return phone ? byPhone(client, phone, ask) : byQr(client, host, ask)
}
