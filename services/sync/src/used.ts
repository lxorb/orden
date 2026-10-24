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
import { noteKey } from './notes'
import { picturesOf } from './pictures'
import { readSpaceFiles } from './spaces/files'
import type { Env } from './types'

/** A space that has not been emptied for good: a purged space keeps its row as a marker
 *  (trash.ts), and what is still named under it - a chat's files, kept a month - is not
 *  anything a space uses. */
const LIVE = '(sp.deleted = 0 or sp.deleted_at is not null)'

/** The owners other than this account of the spaces that use any of these hashes, and
 *  which of the hashes each one's spaces use. */
export async function usedElsewhere(
  env: Env,
  userId: string,
  hashes: ReadonlySet<string>,
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
        and sp.user_id <> ?1 and ${LIVE}
     union
     select sp.user_id as owner, n.paper as hash
       from notes n join spaces sp on sp.id = n.space_id
      where n.paper is not null and n.paper in (select value from json_each(?2))
        and sp.user_id <> ?1 and ${LIVE}
     union
     select sp.user_id as owner, p.hash as hash
       from note_pictures p join notes n on n.id = p.note_id join spaces sp on sp.id = n.space_id
      where p.hash in (select value from json_each(?2)) and sp.user_id <> ?1 and ${LIVE}
        and exists (select 1 from blobs b
                     where b.hash = p.hash and b.user_id = ?1 and b.type like 'image/%')
     union
     select sp.user_id as owner, f.hash as hash
       from chat_files f join chats c on c.id = f.chat_id join spaces sp on sp.id = c.space_id
      where f.hash in (select value from json_each(?2)) and sp.user_id <> ?1 and ${LIVE}`,
  )
    .bind(userId, held)
    .all<{ owner: string; hash: string }>()
  for (const one of used) owe(one.owner, one.hash)

  // And the files a space records, which are a list in one column: only the spaces
  // whose list has one of the hashes in it at all are read, and then read properly.
  const { results: listing } = await env.DB.prepare(
    `select user_id as owner, files from spaces sp
      where user_id <> ?1 and ${LIVE}
        and exists (select 1 from json_each(?2) m where instr(lower(sp.files), m.value) > 0)`,
  )
    .bind(userId, held)
    .all<{ owner: string; files: string }>()
  for (const one of listing) {
    for (const file of readSpaceFiles(one.files)) {
      if (hashes.has(file.hash)) owe(one.owner, file.hash)
    }
  }

  return owed
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
    .filter(([, hashes]) => hashes.size)
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
 *  to nothing. */
export async function unreadUses(
  env: Env,
  user: { id: string; email: string },
  pictures: ReadonlySet<string>,
  owed: Map<string, Set<string>>,
): Promise<void> {
  if (!pictures.size) return
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

  let budget = MOST_READ

  for (const one of written) {
    const { results: notes } = await env.DB.prepare(
      one.item
        ? `select id from notes where space_id = ?1 and id = ?2 and size > 0 and kind != 'file'
              and front_rev < ?3`
        : `select id from notes where space_id = ?1 and size > 0 and kind != 'file'
              and front_rev < ?3 limit ?2`,
    )
      .bind(one.space, one.item || budget + 1, FRONT_REV)
      .all<{ id: string }>()

    if (notes.length > budget && one.role === 'write') {
      for (const hash of pictures) owe(one.owner, hash)
      budget = 0
      continue
    }
    if (notes.length > budget) notes.length = budget

    budget -= notes.length
    for (const hash of await picturesIn(env, one.space, notes)) {
      if (pictures.has(hash)) owe(one.owner, hash)
    }
  }
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
