import { cleanPersonName, NAME_LIMIT, newId, now, randomToken, sha256 } from './crypto'
import type { Env, Guest, User } from './types'

const GUEST_TTL = 90 * 24 * 60 * 60 * 1000

const DEVICE_LIMIT = 24

const WORDS = [
  'fox',
  'wren',
  'moth',
  'hare',
  'lark',
  'newt',
  'owl',
  'elk',
  'ibis',
  'crane',
  'vole',
  'seal',
  'stoat',
  'tern',
  'pike',
  'finch',
]

function device(given: string | null): string | null {
  const said = (given ?? '').replace(/\s+/g, ' ').trim()
  if (!said || said.length > DEVICE_LIMIT) return null

  return /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(said) ? said : null
}

function guestName(hint: string | null): string {
  const platform = device(hint) ?? 'Guest'
  const word = WORDS[Math.floor(Math.random() * WORDS.length)] ?? WORDS[0] ?? ''

  return `${platform} ${word}`
}

export async function newGuest(
  env: Env,
  hint: string | null,
  named: string | null,
  email: string | null,
): Promise<{ guest: Guest; token: string }> {
  const chosen = cleanPersonName(named ?? '').slice(0, NAME_LIMIT)
  const guest: Guest = {
    id: newId(),
    name: chosen || guestName(hint),
    email,
    created_at: now(),
  }

  await env.DB.prepare('insert into guests (id, name, email, created_at) values (?, ?, ?, ?)')
    .bind(guest.id, guest.name, guest.email, guest.created_at)
    .run()

  return { guest, token: await openGuestSession(env, guest.id) }
}

async function openGuestSession(env: Env, guestId: string): Promise<string> {
  await env.DB.prepare('delete from guest_sessions where expires_at < ?').bind(now()).run()

  const token = randomToken()
  await env.DB.prepare(
    'insert into guest_sessions (token_hash, guest_id, created_at, expires_at) values (?, ?, ?, ?)',
  )
    .bind(await sha256(token), guestId, now(), now() + GUEST_TTL)
    .run()

  return token
}

export async function guestForToken(env: Env, token: string): Promise<Guest | null> {
  const row = await env.DB.prepare(
    `select g.id, g.name, g.email, g.created_at
       from guest_sessions s join guests g on g.id = s.guest_id
      where s.token_hash = ? and s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<Guest>()

  return row ?? null
}

export async function renameGuest(env: Env, guestId: string, name: string): Promise<void> {
  await env.DB.prepare('update guests set name = ? where id = ?').bind(name, guestId).run()
}

export function presentGuest(guest: Guest) {
  return { id: guest.id, name: guest.name }
}

const OPEN_TO_GUESTS: readonly { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/v1\/me$/ },
  { method: 'PATCH', path: /^\/v1\/me$/ },
  { method: 'GET', path: /^\/v1\/spaces$/ },
  { method: 'GET', path: /^\/v1\/shared$/ },
  { method: 'DELETE', path: /^\/v1\/shared\/[^/]+$/ },
  { method: 'PATCH', path: /^\/v1\/spaces\/[^/]+$/ },
  { method: 'GET', path: /^\/v1\/spaces\/[^/]+\/changes$/ },
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/notes$/ },
  {
    method: 'PUT',
    path: /^\/v1\/spaces\/[^/]+\/(bookmarks|icons|arranged|files|graph|excluded|archived|sort)$/,
  },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'PUT', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'DELETE', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+\/paper$/ },
  { method: 'DELETE', path: /^\/v1\/spaces\/[^/]+\/share\/me$/ },
  {
    method: 'GET',
    path: /^\/v2\/spaces\/[^/]+\/(feed|snapshot|maps)$/,
  },
  { method: 'POST', path: /^\/v2\/spaces\/[^/]+\/(prepare|ops|index|search)$/ },
  { method: 'PATCH', path: /^\/v2\/spaces\/[^/]+\/maps$/ },
  { method: 'POST', path: /^\/v2\/docs\/(pull|push|keep)$/ },
  { method: 'GET', path: /^\/v2\/files\/[^/]+\/[^/]+$/ },
  { method: 'PUT', path: /^\/v2\/files\/[^/]+\/[^/]+$/ },
  { method: 'GET', path: /^\/v2\/chats$/ },
  { method: 'POST', path: /^\/v2\/chats$/ },
  { method: 'GET', path: /^\/v2\/chats\/search$/ },
  { method: 'GET', path: /^\/v2\/chats\/[^/]+\/(members|events|state|search|scheduled)$/ },
  { method: 'GET', path: /^\/v2\/chats\/[^/]+\/files\/[^/]+$/ },
  { method: 'POST', path: /^\/v2\/chats\/[^/]+\/(events|read)$/ },
  { method: 'PUT', path: /^\/v2\/chats\/[^/]+\/me$/ },
  { method: 'PATCH', path: /^\/v2\/chats\/[^/]+$/ },
]

export function guestMayReach(method: string, path: string): boolean {
  return OPEN_TO_GUESTS.some((one) => one.method === method && one.path.test(path))
}

export async function claimGuest(env: Env, guestId: string, user: User): Promise<void> {
  const { results } = await env.DB.prepare(
    `select space_id, item, role from guest_members
      where guest_id = ? and joined_at is not null limit 200`,
  )
    .bind(guestId)
    .all<{ space_id: string; item: string; role: string }>()

  for (const held of results) {
    await env.DB.prepare(
      `insert into space_members (space_id, email, item, role, joined_at, created_at)
       select ?1, ?2, ?3, ?4, ?5, ?5
        where not exists (select 1 from spaces where id = ?1 and user_id = ?6)
       on conflict(space_id, email, item)
         do update set joined_at = coalesce(space_members.joined_at, ?5)`,
    )
      .bind(held.space_id, user.email, held.item, held.role, now(), user.id)
      .run()

    await env.DB.prepare(
      'delete from guest_members where guest_id = ? and space_id = ? and item = ?',
    )
      .bind(guestId, held.space_id, held.item)
      .run()
  }

  await forgetEmptyGuest(env, guestId)
}

export async function claimGuestsAt(env: Env, user: User): Promise<void> {
  const { results } = await env.DB.prepare('select id from guests where email = ? limit 50')
    .bind(user.email)
    .all<{ id: string }>()

  for (const one of results) await claimGuest(env, one.id, user)
}

export async function forgetEmptyGuest(env: Env, guestId: string): Promise<void> {
  await env.DB.prepare(
    'delete from guests where id = ? and not exists (select 1 from guest_members where guest_id = ?)',
  )
    .bind(guestId, guestId)
    .run()
}

const WAITED_FOR = 30 * 24 * 60 * 60 * 1000

export async function expireGuests(env: Env, at: number): Promise<number> {
  const cutoff = at - WAITED_FOR

  const waiting = await env.DB.prepare(
    'delete from guest_members where joined_at is null and created_at < ?',
  )
    .bind(cutoff)
    .run()

  const nobody = await env.DB.prepare(
    `delete from guests
      where created_at < ?
        and not exists (select 1 from guest_members where guest_id = guests.id)`,
  )
    .bind(cutoff)
    .run()

  return waiting.meta.changes + nobody.meta.changes
}
