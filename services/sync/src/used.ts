/** Which spaces of other people use a blob, and handing it to their owners.
 *
 *  A blob is held by whoever uploaded it, and a writer in somebody else's space uploads
 *  their own: the picture in the owner's note, the paper of a page note, a file of the
 *  space and a file posted in its chat are all the writer's row. So when that row is
 *  about to go - the account is deleted (erase.ts), or the writer gives the bytes back
 *  (blobs.ts) - the bytes another account's space still uses are handed to that space's
 *  owner instead, and only what nobody else's space uses goes from the bucket.
 *
 *  What decides is which spaces use the bytes now, not who is a member where: a writer
 *  who left, or was taken out, wrote what they wrote. Every space is asked, through the
 *  rows that name a blob by its hash - a file of its tree, a page note's paper, the
 *  pictures written down for each note's body (pictures.ts), a file it records and a
 *  file posted in one of its chats. A note's body counts only for a blob this account
 *  holds as a picture: a paper or a file is named by its own column, and a hash
 *  somebody wrote into a note of their own does not make the bytes theirs. */

import { FRONT_REV } from './blog/front'
import { askChat } from './chats/ask'
import { noteKey } from './notes'
import { picturesOf } from './pictures'
import { readSpaceFiles } from './spaces/files'
import type { Env } from './types'
import { picturesOfVersion, versionKey } from './versions'

/** A space that has not been emptied for good: a purged space keeps its row as a marker
 *  (trash.ts), and what is still named under it - a chat's files, kept a month - is not
 *  anything a space uses. */
const LIVE = '(sp.deleted = 0 or sp.deleted_at is not null)'

/** The owners other than this account of the spaces that use any of these hashes, and
 *  which of the hashes each one's spaces use. With `own`, this account's own spaces
 *  are asked too, under its own id: a face given back may be a picture in its notes. */
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

  // Every row that names one of them by its hash, in a space of somebody else's.
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

  // And the files a space records, which are a list in one column: only the spaces
  // whose list has one of the hashes in it at all are read, and then read properly.
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

/** What else of an account's own holds a blob, beside its spaces' notes, files and
 *  chats (`usedElsewhere` with `own`). `used` for:
 *  - its face or the theme of one of its sites;
 *  - any chat naming it, of whoever's space: the account may have posted it there, which
 *    nothing says, and editing that message asks for a row of its own (`holds` in
 *    chats/log.ts), so it is not handed over;
 *  - a post it holds for later, in any chat, which needs the row when it goes;
 *  - a picture in a version of a note in a space it is in, which restoring would show.
 *  `unknown` while one of those cannot be asked or read yet, or for a picture while one of
 *  its own notes was written before its pictures were and has not been read since. And
 *  null for none. */
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

/** The statements that give each owner a row of their own for the hashes they are
 *  owed, copied from the row this account holds, so the bytes stay kept once it goes. */
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

/** How many note bodies `unreadUses` reads, over every space it looks in: a bound on
 *  what one request asks of the bucket. */
const MOST_READ = 250

/** How many chats' objects one request asks what is held for later. */
const MOST_ASKED = 100

/** What has been read of the notes written before their pictures were, kept across
 *  every question one request asks: a space's unread notes are the same bodies whoever
 *  asks and about whichever picture, so a sweep that asks about many reads them once,
 *  and one budget of bodies is shared between all of it. */
export interface Reading {
  left: number
  /** By space (and note, for somebody handed one note): the pictures its unread notes
   *  show, and whether every one of them was read. */
  read: Map<string, { pictures: Set<string>; whole: boolean }>
  /** How many chats' objects may still be asked. */
  asks: number
  /** By account: the blobs its held posts name, or null for one that could not be asked. */
  held: Map<string, Set<string> | null>
  /** By account: whether what is left of the versions in its spaces to read was read. */
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

/** The spaces an account is in, on a space aliased `sp` with the account at `?1`. */
const ITS_SPACES = `(sp.user_id = ?1
  or exists (select 1 from space_members m join users u on u.email = m.email
              where m.space_id = sp.id and u.id = ?1))`

/** The blobs an account's held posts name, in any chat it can reach. They live in each
 *  chat's own object, where nothing can be asked of them together, so each is asked; null
 *  where one did not answer, or there are more than are left to ask. */
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
      const answer = await askChat(env, chat.id, 'held-files', {
        'x-nib-held-by': `user:${userId}`,
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

/** Whether a version of a note in an account's spaces shows a picture, as each version's
 *  row says: `used`, `unknown` while a version has none written down yet, or null.
 *
 *  A version's row has them from when it was kept (versions.ts). One from before there
 *  was anywhere to put them (0071) is read here as far as what is left goes and written
 *  down, so what one sweep read the next does not read again, and an account with more
 *  of them than one request reads gets to the end of them over several. Until it does
 *  nothing it holds as a picture is let go of. */
async function versionShows(
  env: Env,
  userId: string,
  hash: string,
  done: Reading,
): Promise<'used' | 'unknown' | null> {
  if (!(await versionsRead(env, userId, done))) return 'unknown'

  // Asked of the rows as they are now, one found being all it takes: a version kept with
  // nothing written down since the read above counts as well.
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

/** The versions in an account's spaces with no pictures written down, read as far as
 *  what is left goes: whether that was all of them. */
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

/** And the pictures in notes written before their pictures were written down, which
 *  have none yet until the nightly sweep reads them (blog/fill.ts), added to `owed`.
 *
 *  Their bodies are read the old way, in the spaces this account is still a member of,
 *  whatever its role, because a writer made a reader wrote what they wrote. A space
 *  with more of them than is left to read hands over every picture where this account
 *  may write, rather than guessing, because a picture somebody pays for is better than
 *  a hole in their note; in one it only reads, that would hand the owner pictures that
 *  were never there, so it is read as far as what is left goes. What this cannot reach
 *  is an unread note of a space this account is no longer in, which the sweep shrinks
 *  to nothing.
 *
 *  Without `guess`, a space with more unread notes than is left to read hands nothing
 *  over on the chance it shows a picture, and the answer is false: not everything that
 *  might use the pictures was read. That is for giving a file back, where the person
 *  is asking to stop paying for it and handing it to somebody else blindly would make
 *  them pay instead; an erase guesses, because keeping is better than losing there.
 *
 *  `done` is what was read already in this request; see `Reading`. */
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

/** Every picture the service holds that these notes show, read a handful at a time. */
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
