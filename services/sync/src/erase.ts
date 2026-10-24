/** Deleting an account: everything it owns, and nothing anybody else does.
 *
 *  What goes is the account and whatever it is the owner of - its spaces and every
 *  row inside them, the sessions and tokens that act for it, its second factor, its
 *  settings, the codes and ceilings kept at its address. What stays is everybody
 *  else's: a space somebody shared with this account loses a member and nothing
 *  else, and a picture or a version whose bytes another account or another note
 *  still names is not this account's to take away.
 *
 *  The rows go in one batch, which D1 runs as one transaction, so a failure leaves
 *  the account exactly as it was rather than half of one. The same transaction
 *  writes down what the rows were the only record of - the note bodies, the
 *  versions, the pictures, the rooms - and those are emptied afterwards from that
 *  list; see leftovers.ts. Afterwards is also when the published addresses are let
 *  go and the open sockets closed, because until the rows are gone they still
 *  answer - and when the address is told it happened, which is the receipt a person
 *  who asked keeps and the alarm for one who did not. */

import { now } from './crypto'
import { goneMessage, mailer } from './email'
import { note } from './failed'
import { releaseDomain } from './hostnames'
import { sweepLeftovers } from './leftovers'
import { FRONT_REV } from './blog/front'
import { noteKey } from './notes'
import { picturesOf } from './pictures'
import { closeChats } from './chats/ask'
import { closeRooms } from './rooms'
import { readSpaceFiles } from './spaces/files'
import type { Env, User } from './types'

/** Every statement here is written with three numbered parameters: `?1` the
 *  account's id, `?2` its address, `?3` the moment. */
const OWNED = 'select id from spaces where user_id = ?1'
const OWNED_NOTES = `select id from notes where space_id in (${OWNED})`
/** The chats of those spaces; see chats/. */
const OWNED_CHATS = `select id from chats where space_id in (${OWNED})`

/** What the rows are the only record of, written down before they go. */
const NOTED: readonly string[] = [
  `insert or ignore into leftovers (what, since)
     select 'spaces/' || space_id || '/' || id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into leftovers (what, since)
     select 'rooms/' || id, ?3 from notes where space_id in (${OWNED})`,
  // And the snapshot of each note's document a room writes at every settle (sync v2);
  // see rooms/epoch.ts.
  `insert or ignore into leftovers (what, since)
     select 'crdt/' || id, ?3 from notes where space_id in (${OWNED})`,
  // And the ids themselves, which nothing may be made under again: a room is named by
  // the id, and is emptied after the row has gone (0052).
  `insert or ignore into retired_notes (id, since)
     select id, ?3 from notes where space_id in (${OWNED})`,
  `insert or ignore into leftovers (what, since)
     select distinct 'versions/' || hash, ?3 from note_versions where note_id in (${OWNED_NOTES})`,
  `insert or ignore into leftovers (what, since)
     select 'blobs/' || hash, ?3 from blobs where user_id = ?1`,
  // The bytes of web logins that travelled between computers, kept until those were
  // removed (#393) and swept with the account still, and the account's hub, which keeps
  // storage of its own.
  `insert or ignore into leftovers (what, since)
     select 'web/' || user_id || '/' || key, ?3 from web_states where user_id = ?1`,
  `insert or ignore into leftovers (what, since)
     select 'web/' || user_id || '/chunks/' || name, ?3 from web_chunks where user_id = ?1`,
  `insert or ignore into leftovers (what, since) values ('hubs/' || ?1, ?3)`,
  // Its online terminal machine, whose object holds the container and its state, and
  // the home's latest backup in the homes bucket; see machines/.
  `insert or ignore into leftovers (what, since)
     select 'machines/' || id, ?3 from machines where user_id = ?1`,
  `insert or ignore into leftovers (what, since)
     select 'homes/' || backup_key, ?3 from machines where user_id = ?1 and backup_key is not null`,
  // The chats of its spaces, whose objects keep their logs in storage of their own.
  `insert or ignore into leftovers (what, since) select 'chats/' || id, ?3 from (${OWNED_CHATS})`,
  // And the files it posted into chats of other people's spaces, handed to each space's
  // owner as a picture in their note is (`handedOn`): the message stays, so the file does.
  `insert into blobs (hash, user_id, size, type, created_at)
     select b.hash, sp.user_id, b.size, b.type, ?3
       from blobs b join chat_files f on f.hash = b.hash
       join chats c on c.id = f.chat_id join spaces sp on sp.id = c.space_id
      where b.user_id = ?1 and sp.user_id <> ?1
   on conflict(hash, user_id) do nothing`,
  // Its messages in other people's chats stay, as a deleted account's (decision 7.8);
  // the line saying who wrote a chat's last one names nobody now.
  `update chats set last_by = null
    where last_by = 'user:' || ?1`,
]

/** Every table an account leaves a row in, and the statement that takes those rows
 *  away, in the order they run: what points at a row before the row. Keyed by the
 *  table so that test/erase.test.ts can hold the list to the schema - a table that
 *  is in neither this nor that test's short list of tables that hold nothing of an
 *  account fails it. */
export const ERASED: readonly (readonly [table: string, sql: string])[] = [
  ['note_versions', `delete from note_versions where note_id in (${OWNED_NOTES})`],
  ['note_search', `delete from note_search where space_id in (${OWNED})`],
  ['note_pictures', `delete from note_pictures where note_id in (${OWNED_NOTES})`],
  ['blog_paths', `delete from blog_paths where space_id in (${OWNED})`],
  ['form_answers', `delete from form_answers where space_id in (${OWNED})`],
  ['room_sockets', `delete from room_sockets where space_id in (${OWNED}) or who = ?1`],
  // Its spaces' chats, and its read places and open sockets in everybody's. Its
  // messages in other people's chats stay, as a deleted account's (docs/chats.md 4.18).
  ['chat_reads', `delete from chat_reads where chat_id in (${OWNED_CHATS}) or who = ?1`],
  ['chat_files', `delete from chat_files where chat_id in (${OWNED_CHATS})`],
  [
    'chat_sockets',
    `delete from chat_sockets
      where chat_id in (${OWNED_CHATS}) or who = ?1`,
  ],
  ['chats', `delete from chats where space_id in (${OWNED})`],
  // Everybody's way into this account's spaces, and this account's way into
  // everybody else's: an invitation to it, a request it made, a file it was given.
  ['space_members', `delete from space_members where space_id in (${OWNED}) or email = ?2`],
  ['space_links', `delete from space_links where space_id in (${OWNED})`],
  ['space_requests', `delete from space_requests where space_id in (${OWNED}) or email = ?2`],
  ['guest_members', `delete from guest_members where space_id in (${OWNED})`],
  // A guest who said it was at this address only said so: it is not the account's to
  // take away, but the address it typed is, and no sign-in there claims it now (#488).
  ['guests', 'update guests set email = null where email = ?2'],
  ['notes', `delete from notes where space_id in (${OWNED})`],
  // Sync v2's tree of those spaces, the answers it gave their operations, and the maps
  // they keep per entry; see sync2/.
  ['folders', `delete from folders where space_id in (${OWNED})`],
  ['tree_ops', `delete from tree_ops where space_id in (${OWNED})`],
  ['space_entries', `delete from space_entries where space_id in (${OWNED})`],
  ['space_cursor', `delete from space_cursor where space_id in (${OWNED})`],
  // What it was called in each space it was in, and what everybody was called in its own.
  ['space_nicks', `delete from space_nicks where user_id = ?1 or space_id in (${OWNED})`],
  // The ceilings counted against the account, its address and its spaces - and a
  // site's password guesses, which are counted per space and machine. What is
  // counted against a machine stays: that is about the machine.
  [
    'limits',
    `delete from limits
      where key in (?1, ?2) or key in (${OWNED})
         or (instr(key, ':') > 0 and substr(key, 1, instr(key, ':') - 1) in (${OWNED}))
         or (instr(key, ':') > 0 and substr(key, 1, instr(key, ':') - 1) = ?1)`,
  ],
  // The model list kept for it, a second factor half set up or half answered, and
  // the ticket that is deleting it now.
  ['cached', "delete from cached where key = ?1 or value = ?1 or value like ?1 || ':%'"],
  ['spaces', 'delete from spaces where user_id = ?1'],
  ['blobs', 'delete from blobs where user_id = ?1'],
  ['sessions', 'delete from sessions where user_id = ?1'],
  ['feedback', 'delete from feedback where user_id = ?1'],
  ['mcp_tokens', 'delete from mcp_tokens where user_id = ?1'],
  ['oauth_codes', 'delete from oauth_codes where user_id = ?1'],
  ['oauth_grants', 'delete from oauth_grants where user_id = ?1'],
  ['recovery_codes', 'delete from recovery_codes where user_id = ?1'],
  ['login_codes', 'delete from login_codes where email = ?2'],
  ['mailed', 'delete from mailed where email = ?2'],
  ['mailed_days', 'delete from mailed_days where email = ?2'],
  // Its devices, and what web logins that travelled left (#393): the key wrapped to
  // each device before the device, and the states whose bytes NOTED has already
  // written down.
  ['web_keys', 'delete from web_keys where user_id = ?1'],
  ['devices', 'delete from devices where user_id = ?1'],
  ['web_states', 'delete from web_states where user_id = ?1'],
  ['web_chunks', 'delete from web_chunks where user_id = ?1'],
  // Its AI accounts, sealed, and the keys to them wrapped to each device.
  ['ai_vaults', 'delete from ai_vaults where user_id = ?1'],
  ['ai_devices', 'delete from ai_devices where user_id = ?1'],
  // Where its devices were pushed to, and the reminders kept to push them.
  ['push_targets', 'delete from push_targets where user_id = ?1'],
  ['push_reminders', 'delete from push_reminders where user_id = ?1'],
  // Its online terminal machine: the audit, the sessions, the months and the machine,
  // the audit before the machine it is keyed by.
  [
    'machine_events',
    'delete from machine_events where machine in (select id from machines where user_id = ?1)',
  ],
  ['term_sessions', 'delete from term_sessions where user_id = ?1'],
  ['machine_usage', 'delete from machine_usage where user_id = ?1'],
  ['machines', 'delete from machines where user_id = ?1'],
  // Whether it was here; its face is two rows of `blobs`, above.
  ['presence', 'delete from presence where user_id = ?1'],
  // When it moved between sync v1 and v2; see sync2/gate.ts.
  ['sync_flips', 'delete from sync_flips where user_id = ?1'],
  ['users', 'delete from users where id = ?1'],
]

/** Takes the account away. Answers once its rows have gone; what is outside the
 *  database follows as far as one request goes, and the nightly job does the rest. */
export async function eraseAccount(env: Env, user: User): Promise<void> {
  const at = now()
  const values = [user.id, user.email, at]

  // Read before the rows go, because afterwards nothing says either: which domains
  // of its own a certificate was asked for, and which rooms have somebody in them
  // who is on the way out.
  const { results: domains } = await env.DB.prepare(
    'select blog_domain as domain from spaces where user_id = ? and blog_domain is not null',
  )
    .bind(user.id)
    .all<{ domain: string }>()

  const { results: open } = await env.DB.prepare(
    `select note_id, who from room_sockets
      where space_id in (${OWNED}) or who = ?1`,
  )
    .bind(user.id)
    .all<{ note_id: string; who: string }>()

  const { results: chatting } = await env.DB.prepare(
    'select chat_id, who from chat_sockets where who = ?1',
  )
    .bind(user.id)
    .all<{ chat_id: string; who: string }>()

  const handed = await handedOn(env, user, at)

  await env.DB.batch([
    ...NOTED.map((sql) => bound(env, sql, values)),
    ...handed,
    ...ERASED.map(([, sql]) => bound(env, sql, values)),
  ])

  // The account is gone. Nothing below may say otherwise: every step is outside
  // the database, and one that fails is written down and picked up again by the
  // nightly job rather than answered as a failure to delete.
  try {
    await closeRooms(env, open)
    await closeChats(env, chatting)
    for (const { domain } of domains) await releaseDomain(env, domain)
    await sweepLeftovers(env)
  } catch (error) {
    note('erase', error, null)
  }

  // And the receipt, to the address that proved it. Not counted against the mail
  // ceilings: counting it would write rows at the address a moment after every one
  // of them went, and the deletion it reports already took a counted code to reach.
  // A receipt that does not go is written down by the mailer and nothing more.
  const receipt = goneMessage()
  await mailer(env).send(user.email, receipt.subject, receipt)
}

/** A statement bound with as many of the values as it has numbered parameters. D1
 *  and SQLite both refuse a value for a parameter the statement does not have. */
function bound(env: Env, sql: string, values: readonly unknown[]): D1PreparedStatement {
  const most = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((one) => Number(one[1])))
  return env.DB.prepare(sql).bind(...values.slice(0, most))
}

/** How many note bodies the hand-over below reads, over every space it looks in:
 *  a bound on what one request asks of the bucket, beside the rooms the sweep
 *  after it asks. */
const MOST_READ = 250

/** The pictures, files and papers this account put into somebody else's space,
 *  handed to that space's owner.
 *
 *  A picture is held by whoever uploaded it, and a writer in a shared space uploads
 *  their own: so the picture in the owner's note is the writer's row, and deleting
 *  the writer would otherwise take the picture out of a space that stays. Whatever
 *  another account already holds is left alone - its row keeps the bytes. For the
 *  rest, what decides is which spaces of other people use them now, not who is a
 *  member where: a writer who left, or was taken out, wrote what they wrote, and a
 *  picture a stranger kept alive by holding the same bytes is still in the owner's
 *  note once the writer and then the stranger have gone. So every space is asked,
 *  through the rows that name a blob by its hash - a file of its tree, a page note's
 *  paper, a file it records, and the pictures written down for each note's body (see
 *  pictures.ts) - and only what a space uses is handed to its owner.
 *
 *  A note written before its pictures were written down has none yet, until the
 *  nightly sweep reads it (blog/fill.ts). Those are read here the old way, in the
 *  spaces this account is still a member of, whatever its role, because a writer
 *  made a reader wrote what they wrote. A space with more of them than is left to
 *  read hands over everything unread where this account may write, rather than
 *  guessing, because a picture somebody pays for is better than a hole in their
 *  note. What that cannot reach is an unread note of a space this account is no
 *  longer in, which the sweep shrinks to nothing. */
async function handedOn(env: Env, user: User, at: number): Promise<D1PreparedStatement[]> {
  const { results: alone } = await env.DB.prepare(
    `select hash, type from blobs b where user_id = ?1
       and not exists (select 1 from blobs o where o.hash = b.hash and o.user_id <> ?1)`,
  )
    .bind(user.id)
    .all<{ hash: string; type: string }>()
  if (!alone.length) return []

  const mine = new Set(alone.map((one) => one.hash))
  // What a note's body can show, which is a picture and nothing else: a paper or a
  // file is named by its own column, never by a hash somebody wrote into a note.
  const pictures = new Set(
    alone.filter((one) => one.type.startsWith('image/')).map((one) => one.hash),
  )
  const held = JSON.stringify([...mine])
  const owed = new Map<string, Set<string>>()
  const owe = (owner: string, hash: string) => {
    const found = owed.get(owner) ?? new Set<string>()
    owed.set(owner, found)
    found.add(hash)
  }

  // Every row that names one of them by its hash, in a space of somebody else's.
  const { results: used } = await env.DB.prepare(
    `select sp.user_id as owner, n.hash as hash
       from notes n join spaces sp on sp.id = n.space_id
      where n.kind = 'file' and n.hash in (select value from json_each(?2)) and sp.user_id <> ?1
     union
     select sp.user_id as owner, n.paper as hash
       from notes n join spaces sp on sp.id = n.space_id
      where n.paper is not null and n.paper in (select value from json_each(?2))
        and sp.user_id <> ?1
     union
     select sp.user_id as owner, p.hash as hash
       from note_pictures p join notes n on n.id = p.note_id join spaces sp on sp.id = n.space_id
      where p.hash in (select value from json_each(?3)) and sp.user_id <> ?1`,
  )
    .bind(user.id, held, JSON.stringify([...pictures]))
    .all<{ owner: string; hash: string }>()
  for (const one of used) owe(one.owner, one.hash)

  // And the files a space records, which are a list in one column: only the spaces
  // whose list has one of the hashes in it at all are read, and then read properly.
  const { results: listing } = await env.DB.prepare(
    `select user_id as owner, files from spaces sp
      where user_id <> ?1
        and exists (select 1 from json_each(?2) m where instr(lower(sp.files), m.value) > 0)`,
  )
    .bind(user.id, held)
    .all<{ owner: string; files: string }>()
  for (const one of listing) {
    for (const file of readSpaceFiles(one.files)) if (mine.has(file.hash)) owe(one.owner, file.hash)
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

    // The guess is for a space this account may write in, where anything of its own
    // may be: in one it only reads, it would hand the owner pictures that were never
    // there. That one is read as far as what is left goes.
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

  return [...owed]
    .filter(([, hashes]) => hashes.size)
    .map(([owner, hashes]) =>
      env.DB.prepare(
        `insert into blobs (hash, user_id, size, type, created_at)
           select hash, ?2, size, type, ?3 from blobs
            where user_id = ?1 and hash in (select value from json_each(?4))
         on conflict(hash, user_id) do nothing`,
      ).bind(user.id, owner, at, JSON.stringify([...hashes])),
    )
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
