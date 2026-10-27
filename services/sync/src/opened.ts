/** The rows saying somebody has a file or a chat open (`room_sockets`, 0020, and
 *  `chat_sockets`, 0047), and the clearing of the ones nothing will take away.
 *
 *  A row is written once, as a socket joins, and taken away as it closes. A row an
 *  object never got to take away - an object the runtime dropped, a socket the network
 *  took - has to go some other way, and it used to go by age alone: whatever was a day
 *  old was deleted as the next socket anywhere joined. But a row is the whole of how a
 *  revocation reaches a socket, and the client keeps a socket for as long as the file
 *  is open, which can be days. So a member left in a note over a weekend lost their row
 *  to somebody else's join, and taking them out of the space on Monday reached nothing:
 *  they went on typing into the owner's note.
 *
 *  So age only says which rows to ask about. The object a day-old row names is asked
 *  whether that person still has a socket in it; one that does keeps the row for
 *  another day, one that does not loses it. An object that does not answer keeps it
 *  too: a row too many is a room woken for nothing at a revocation, a row too few is a
 *  socket nobody can close. */

import type { Env } from './types'

/** How long a row is believed without asking. Well past any sitting a room stays awake
 *  for, so the asking is rare. */
const OPEN_FOR = 24 * 60 * 60 * 1000

/** How many day-old rows one join asks about. Rows go stale far slower than sockets
 *  join, so a few each time keeps the table drained without making a join wait on
 *  many objects. */
const ASKED_AT_ONCE = 10

/** The header an object is asked with whether this person has a socket in it, and
 *  what it answers. */
export const OPEN_HEADER = 'x-nib-open'
interface OpenAnswer {
  open: boolean
}

type Table = { name: 'room_sockets'; key: 'note_id' } | { name: 'chat_sockets'; key: 'chat_id' }

/** The day-old rows of `table`, a few at a time, asked about. `stillOpen` says whether
 *  the object named by `id` has a socket of `who`, or null where it could not be asked. */
export async function sweepOpened(
  env: Env,
  table: Table,
  stillOpen: (id: string, who: string) => Promise<boolean | null>,
): Promise<void> {
  const before = Date.now() - OPEN_FOR
  const { results } = await env.DB.prepare(
    `select ${table.key} as id, who from ${table.name}
      where opened_at < ? order by opened_at limit ?`,
  )
    .bind(before, ASKED_AT_ONCE)
    .all<{ id: string; who: string }>()

  await Promise.all(
    results.map(async ({ id, who }) => {
      const open = await stillOpen(id, who).catch(() => null)
      // Only a row still as old as it was read: one the socket's own join wrote again
      // in the meantime is a socket's, whatever the object said a moment ago.
      const where = `${table.key} = ? and who = ? and opened_at < ?`
      if (open === false) {
        await env.DB.prepare(`delete from ${table.name} where ${where}`).bind(id, who, before).run()
      } else {
        await env.DB.prepare(`update ${table.name} set opened_at = ? where ${where}`)
          .bind(Date.now(), id, who, before)
          .run()
      }
    }),
  )
}

/** What an object answers when asked whether `who` has a socket in it. */
export function openAnswer(open: boolean): Response {
  return Response.json({ open } satisfies OpenAnswer)
}

/** An object's answer read back: null for anything but a plain yes or no. */
export async function openIn(answer: Response | null): Promise<boolean | null> {
  if (!answer?.ok) return null
  const body: unknown = await answer.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return null
  const open = (body as Partial<OpenAnswer>).open
  return typeof open === 'boolean' ? open : null
}
