import { FRONT_REV } from './site/front'
import { hooks } from './hooks'
import { noteKey } from './notes'
import { picturesOf } from './pictures'
import { readSpaceFiles } from './spaces/files'
import type { Env } from './types'
import { picturesOfVersion, versionKey } from './versions'

const LIVE = '(sp.deleted = 0 or sp.deleted_at is not null)'

export async function usedElsewhere(
  env: Env,
  userId: string,
  hashes: ReadonlySet<string>,
  own = false,
): Promise<Map<string, Set<string>>> {
  const owed = new Map<string, Set<string>>()
  if (!hashes.size) return owed
  const owe = (owner: string, hash: string) => {
    const found = owed.get(owner) ?? new Set<string>()
    owed.set(owner, found)
    found.add(hash)
  }
  const held = JSON.stringify([...hashes])

  const { results: used } = await env.DB.prepare(
    `select sp.user_id as owner, n.hash as hash
       from notes n join spaces sp on sp.id = n.space_id
      where n.kind = 'file' and n.hash in (select value from json_each(?2))
        and (?3 or sp.user_id <> ?1) and ${LIVE}
     union
     select sp.user_id as owner, n.paper as hash
       from notes n join spaces sp on sp.id = n.space_id
      where n.paper is not null and n.paper in (select value from json_each(?2))
        and (?3 or sp.user_id <> ?1) and ${LIVE}
     union
     select sp.user_id as owner, p.hash as hash
       from note_pictures p join notes n on n.id = p.note_id join spaces sp on sp.id = n.space_id
      where p.hash in (select value from json_each(?2))
        and (?3 or sp.user_id <> ?1) and ${LIVE}
        and exists (select 1 from blobs b
                     where b.hash = p.hash and b.user_id = ?1 and b.type like 'image/%')
     union
     select sp.user_id as owner, f.hash as hash
       from chat_files f join chats c on c.id = f.chat_id join spaces sp on sp.id = c.space_id
      where f.hash in (select value from json_each(?2))
        and (?3 or sp.user_id <> ?1) and ${LIVE}`,
  )
    .bind(userId, held, own ? 1 : 0)
    .all<{ owner: string; hash: string }>()
  for (const one of used) owe(one.owner, one.hash)

  const { results: listing } = await env.DB.prepare(
    `select user_id as owner, files from spaces sp
      where (?3 or user_id <> ?1) and ${LIVE}
        and exists (select 1 from json_each(?2) m where instr(lower(sp.files), m.value) > 0)`,
  )
    .bind(userId, held, own ? 1 : 0)
    .all<{ owner: string; files: string }>()
  for (const one of listing) {
    for (const file of readSpaceFiles(one.files)) {
      if (hashes.has(file.hash)) owe(one.owner, file.hash)
    }
  }

  return owed
}

export async function ownOtherwise(
  env: Env,
  userId: string,
  hash: string,
  picture: boolean,
  done: Reading = reading(),
): Promise<'used' | 'unknown' | null> {
  const held = await env.DB.prepare(
    `select 1 as one from users where id = ?1 and instr(coalesce(avatar, ''), ?2) > 0
     union all
     select 1 from spaces sp
      where user_id = ?1 and ${LIVE} and instr(coalesce(site, ''), ?2) > 0
     limit 1`,
  )
    .bind(userId, hash)
    .first()
  if (held) return 'used'

  const named = await env.DB.prepare(
    `select 1 as one from chat_files f join chats c on c.id = f.chat_id
       join spaces sp on sp.id = c.space_id
      where f.hash = ?1 and ${LIVE} limit 1`,
  )
    .bind(hash)
    .first()
  if (named) return 'used'

  const posts = await heldFiles(env, userId, done)
  if (posts === null) return 'unknown'
  if (posts.has(hash)) return 'used'

  if (!picture) return null

  const shown = await versionShows(env, userId, hash, done)
  if (shown !== null) return shown

  const unread = await env.DB.prepare(
    `select 1 as one from notes n join spaces sp on sp.id = n.space_id
      where sp.user_id = ?1 and ${LIVE} and n.size > 0 and n.kind != 'file'
        and n.front_rev < ?2
      limit 1`,
  )
    .bind(userId, FRONT_REV)
    .first()
  return unread ? 'unknown' : null
}

export function handedTo(
  env: Env,
  userId: string,
  owed: ReadonlyMap<string, ReadonlySet<string>>,
  at: number,
): D1PreparedStatement[] {
  return [...owed]
    .filter(([owner, hashes]) => owner !== userId && hashes.size)
    .map(([owner, hashes]) =>
      env.DB.prepare(
        `insert into blobs (hash, user_id, size, type, created_at)
           select hash, ?2, size, type, ?3 from blobs
            where user_id = ?1 and hash in (select value from json_each(?4))
         on conflict(hash, user_id) do nothing`,
      ).bind(userId, owner, at, JSON.stringify([...hashes])),
    )
}

const MOST_READ = 250

const MOST_ASKED = 100

export interface Reading {
  left: number
  read: Map<string, { pictures: Set<string>; whole: boolean }>
  asks: number
  held: Map<string, Set<string> | null>
  versions: Map<string, boolean>
}

export function reading(): Reading {
  return {
    left: MOST_READ,
    read: new Map(),
    asks: MOST_ASKED,
    held: new Map(),
    versions: new Map(),
  }
}

const ITS_SPACES = `(sp.user_id = ?1
  or exists (select 1 from space_members m join users u on u.email = m.email
              where m.space_id = sp.id and u.id = ?1))`

async function heldFiles(env: Env, userId: string, done: Reading): Promise<Set<string> | null> {
  const known = done.held.get(userId)
  if (known !== undefined) return known

  const { results: chats } = await env.DB.prepare(
    `select c.id from chats c join spaces sp on sp.id = c.space_id
      where c.ended_at is null and ${LIVE} and ${ITS_SPACES} limit ?2`,
  )
    .bind(userId, done.asks + 1)
    .all<{ id: string }>()

  let found: Set<string> | null = chats.length > done.asks ? null : new Set()
  if (found) {
    done.asks -= chats.length
    for (const chat of chats) {
      const answer = await hooks().chats.askChat(env, chat.id, 'held-files', {
        'x-orden-held-by': `user:${userId}`,
      })
      if (!answer?.ok) {
        found = null
        break
      }
      const { hashes } = await answer.json<{ hashes: string[] }>()
      for (const hash of hashes) found.add(hash)
    }
  }
  done.held.set(userId, found)
  return found
}

async function versionShows(
  env: Env,
  userId: string,
  hash: string,
  done: Reading,
): Promise<'used' | 'unknown' | null> {
  if (!(await versionsRead(env, userId, done))) return 'unknown'

  const found = await env.DB.prepare(
    `select v.pictures is null as unread from note_versions v join notes n on n.id = v.note_id
       join spaces sp on sp.id = n.space_id
      where (v.pictures is null or instr(v.pictures, ?2) > 0) and ${LIVE} and ${ITS_SPACES}
      limit 1`,
  )
    .bind(userId, hash)
    .first<{ unread: number }>()
  if (!found) return null
  return found.unread ? 'unknown' : 'used'
}

async function versionsRead(env: Env, userId: string, done: Reading): Promise<boolean> {
  const known = done.versions.get(userId)
  if (known !== undefined) return known

  const { results: unread } = await env.DB.prepare(
    `select distinct v.hash from note_versions v join notes n on n.id = v.note_id
       join spaces sp on sp.id = n.space_id
      where v.pictures is null and ${LIVE} and ${ITS_SPACES} limit ?2`,
  )
    .bind(userId, done.left + 1)
    .all<{ hash: string }>()

  let whole = unread.length <= done.left
  const reading = unread.slice(0, done.left)
  done.left -= reading.length
  for (let from = 0; from < reading.length; from += 25) {
    const some = reading.slice(from, from + 25)
    const read = await Promise.all(
      some.map(async (one) => {
        const object = await env.NOTES.get(versionKey(one.hash))
        return picturesOfVersion(object ? await object.text() : '')
      }),
    )
    const writes = some.flatMap((one, at) => {
      const pictures = read[at]
      if (pictures === null || pictures === undefined) {
        whole = false
        return []
      }
      return [
        env.DB.prepare(
          'update note_versions set pictures = ?1 where hash = ?2 and pictures is null',
        ).bind(pictures, one.hash),
      ]
    })
    if (writes.length) await env.DB.batch(writes)
  }
  done.versions.set(userId, whole)
  return whole
}

export async function unreadUses(
  env: Env,
  user: { id: string; email: string },
  pictures: ReadonlySet<string>,
  owed: Map<string, Set<string>>,
  guess = true,
  done: Reading = reading(),
): Promise<boolean> {
  if (!pictures.size) return true
  const owe = (owner: string, hash: string) => {
    const found = owed.get(owner) ?? new Set<string>()
    owed.set(owner, found)
    found.add(hash)
  }

  const { results: written } = await env.DB.prepare(
    `select sp.id as space, sp.user_id as owner, m.item as item, m.role as role
       from space_members m join spaces sp on sp.id = m.space_id
      where m.email = ?1 and sp.user_id <> ?2`,
  )
    .bind(user.email, user.id)
    .all<{ space: string; owner: string; item: string; role: string }>()

  let complete = true

  for (const one of written) {
    const at = one.item ? `${one.space}/${one.item}` : one.space
    let known = done.read.get(at)

    if (!known) {
      const { results: notes } = await env.DB.prepare(
        one.item
          ? `select id from notes where space_id = ?1 and id = ?2 and size > 0 and kind != 'file'
                and front_rev < ?3`
          : `select id from notes where space_id = ?1 and size > 0 and kind != 'file'
                and front_rev < ?3 limit ?2`,
      )
        .bind(one.space, one.item || done.left + 1, FRONT_REV)
        .all<{ id: string }>()

      if (notes.length > done.left && one.role === 'write' && guess) {
        for (const hash of pictures) owe(one.owner, hash)
        done.left = 0
        continue
      }
      const whole = notes.length <= done.left
      if (!whole) notes.length = done.left
      done.left -= notes.length
      known = { pictures: await picturesIn(env, one.space, notes), whole }
      done.read.set(at, known)
    }

    if (!known.whole) complete = false
    for (const hash of known.pictures) if (pictures.has(hash)) owe(one.owner, hash)
  }

  return complete
}

async function picturesIn(
  env: Env,
  space: string,
  notes: readonly { id: string }[],
): Promise<Set<string>> {
  const found = new Set<string>()

  for (let from = 0; from < notes.length; from += 25) {
    const bodies = await Promise.all(
      notes.slice(from, from + 25).map(async (one) => {
        const object = await env.NOTES.get(noteKey(space, one.id))
        return object ? await object.text() : ''
      }),
    )

    for (const body of bodies) for (const hash of picturesOf(body)) found.add(hash)
  }

  return found
}
