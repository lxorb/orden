import { equals, randomBytes } from '../crypto'
import { rounds } from '../rounds'
import { escape } from './head'
import type { SitePassword } from './site'

export const PASSWORD_LIMIT = 200

const LASTS = 30 * 24 * 60 * 60 * 1000

const TICKET = '__Host-orden_site'

const OLD_TICKETS = ['__Host-nib_site', 'nib_site']

export const SITE_ROUNDS = 100_000

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function newSiteKey(): string {
  return hex(randomBytes(32))
}

async function derived(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveBits'])

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: rounds(SITE_ROUNDS) },
    key,
    256,
  )

  return hex(new Uint8Array(bits))
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = hex(randomBytes(16))
  return { salt, hash: await derived(password, salt) }
}

export async function matches(held: SitePassword, given: string): Promise<boolean> {
  if (!given || given.length > PASSWORD_LIMIT) return false
  return equals(await derived(given, held.salt), held.hash)
}

async function signature(key: string, until: number): Promise<string> {
  const signing = await crypto.subtle.importKey(
    'raw',
    bytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signed = await crypto.subtle.sign('HMAC', signing, bytes(String(until)))
  return hex(new Uint8Array(signed))
}

export async function newTicket(held: SitePassword, at: number): Promise<string> {
  const until = at + LASTS
  return `${until}.${await signature(held.key, until)}`
}

async function ticketHolds(
  held: SitePassword,
  ticket: string | null,
  at: number,
): Promise<boolean> {
  if (!ticket) return false

  const [said, signed] = ticket.split('.')
  const until = Number(said)
  if (!signed || !Number.isFinite(until) || until <= at) return false

  return equals(await signature(held.key, until), signed)
}

export function ticketCookie(ticket: string): string {
  const seconds = Math.floor(LASTS / 1000)
  return `${TICKET}=${ticket}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`
}

function ticketsIn(header: string | null): string[] {
  const current: string[] = []
  const old: string[] = []

  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    const value = rest.join('=')
    if (name === TICKET && value) current.push(value)
    if (name && OLD_TICKETS.includes(name) && value) old.push(value)
  }

  return [...current, ...old]
}

export async function letIn(
  held: SitePassword,
  header: string | null,
  at: number,
): Promise<boolean> {
  for (const ticket of ticketsIn(header)) {
    if (await ticketHolds(held, ticket, at)) return true
  }
  return false
}

export function gateBody(site: string, path: string, wrong: boolean): string {
  return `<h1>${escape(site)}</h1>
<form class="gate" method="post" action="${escape(path)}">
<input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" autofocus>
<button type="submit">Read</button>
${wrong ? '<p class="wrong">That is not the password.</p>' : ''}
</form>`
}
