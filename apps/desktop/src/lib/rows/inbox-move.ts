/** An `Inbox.md` Orden made, taken into the space's own inbox (#1044).
 *
 *  Before #1044 a task with no place went into `Inbox.md` at the root of the space,
 *  which the first such task made. That note is taken in where it is still Orden's:
 *  its tasks are added to the space's own inbox (`withTasksOf`: every task once,
 *  however often this runs) and the note goes to the trash the way a delete does, a
 *  version kept first, so nothing is lost even where this guessed wrong. Kept as the
 *  reader's note, untouched, where it is not Orden's:
 *
 *  - the reader chose it as the space's inbox (`chosenInbox`), or
 *  - it holds anything Orden never writes there: a heading, front matter, a line of
 *    prose. Orden wrote task lines alone, with what the task view writes under one
 *    (a description, a comment, a sub-task), and the reader's own edits to those lines
 *    are still tasks, which move with the rest.
 *
 *  Safe to run again and from two devices at once: the own inbox is written before the
 *  note goes, a task already there is not added twice, a note changed since it was read
 *  is left for the next run, and two devices that each made the own inbox apart get one,
 *  every task of both (sync2/pass.ts `mergeDays`, sync/pass.ts). The app runs it for a
 *  space once the space's rows are read and a sync pass has had its turn, and again
 *  whenever an `Inbox.md` arrives, from an older version of Orden on another device or
 *  from the account's connector before it learnt of the own inbox. */

import { withTasksOf } from '@orden/bases/inbox'
import { insideSpace, samePath } from '../space-paths'
import { chosenInbox, INBOX, OLD_INBOX } from './inbox'

/** What the move needs of the app; see inbox-moving.ts for the app's. */
export interface Moving {
  /** A note's words, null where there is none; throws for one that will not read. */
  read(path: string): Promise<string | null>
  /** Writes the own inbox, `made` where it was not there. */
  write(path: string, text: string, made: boolean): Promise<void>
  /** Takes a note away the way a delete does: a version kept, into a trash. */
  remove(path: string): Promise<void>
}

/** A task line: a list marker, then a box. */
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/

/** Whether a note holds only what Orden writes into an inbox: task lines, with the
 *  lines indented under one, and blank lines. */
export function madeByOrden(text: string): boolean {
  let inTask = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    if (TASK.test(line)) {
      inTask = true
      continue
    }
    // Under a task, indented: its description or a comment.
    if (inTask && /^\s/.test(line)) continue
    return false
  }
  return true
}

/** What became of a space's old inbox. */
export type Moved = 'moved' | 'kept' | 'none'

/** Moves the space's old `Inbox.md` into its own inbox where it is Orden's. */
export async function moveOldInbox(root: string, moving: Moving): Promise<Moved> {
  const chosen = chosenInbox(root)
  if (chosen !== null && samePath(chosen, OLD_INBOX, root)) return 'kept'

  const old = insideSpace(root, OLD_INBOX)
  const words = await moving.read(old)
  if (words === null) return 'none'
  if (!madeByOrden(words)) return 'kept'

  const own = insideSpace(root, INBOX)
  const before = await moving.read(own)
  const after = withTasksOf(before ?? '', words)
  if (after !== (before ?? '')) await moving.write(own, after, before === null)

  // Changed since it was read - a task typed into it this moment, or one another device
  // sent - it stays for the next run, which takes that too.
  if ((await moving.read(old)) !== words) return 'kept'
  await moving.remove(old)
  return 'moved'
}
