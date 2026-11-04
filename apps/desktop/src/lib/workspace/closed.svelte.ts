/** The tabs this window has closed, so the last one can come back.
 *
 *  Per window, the way a browser's own Ctrl+Shift+T is: the stack belongs to the
 *  strip it was closed from, and another window's closed notes are that window's
 *  business. It survives a restart because it travels in the session, which is
 *  where the words the disk has not been given yet are written down anyway.
 *
 *  Bounded, and the oldest goes first: a sitting that closes a hundred notes
 *  should not carry the text of all hundred around with it. */

import { movedTo, nameOf, samePath, within } from '../space-paths'
import type { FileOp } from './file-ops'
import type { ClosedTab } from './session'

/** Far more than anybody reaches back through, and few enough that what is kept
 *  with each entry cannot fill the session on its own. */
export const MOST_CLOSED = 20

export class ClosedTabs {
  /** Newest last, the way a stack of things to take back reads. */
  stack = $state<ClosedTab[]>([])

  /** Whether there is anything to reopen, which is what decides whether the
   *  menu offers the row at all. */
  readonly any = $derived(this.stack.length > 0)

  record(closed: ClosedTab) {
    this.stack = [...this.stack, closed].slice(-MOST_CLOSED)
  }

  /** The newest, off the stack, with the tabs closed along with it, newest first so
   *  each goes back to its own place. */
  take(): ClosedTab[] {
    const last = this.stack.at(-1)
    if (!last) return []

    let from = this.stack.length - 1
    while (last.batch !== undefined && this.stack[from - 1]?.batch === last.batch) from -= 1

    const taken = this.stack.slice(from).reverse()
    this.stack = this.stack.slice(0, from)
    return taken
  }

  /** A closed tab of a file that has since moved comes back on the file where it is
   *  now, rather than on a name nothing answers to. */
  follow(op: FileOp) {
    // Words still on an entry never reached the file, so no version holds them and they
    // are nowhere else. They stay, and come back as a draft: not at a path a delete has
    // just emptied, which writing them to would undo.
    if (op.op === 'removed') {
      const path = op.path
      const stack = this.stack.map((closed) => {
        const at = closed.draft.path
        if (at === null || within(path, at) === null || !closed.draft.dirty) return closed
        return { ...closed, draft: { ...closed.draft, path: null } }
      })
      if (stack.some((one, at) => one !== this.stack[at])) this.stack = stack
      return
    }
    if (op.op !== 'moved') return

    const stack = this.stack.map((closed) => {
      const path = closed.draft.path === null ? null : movedTo(closed.draft.path, op.from, op.to)
      return path === null
        ? closed
        : { ...closed, draft: { ...closed.draft, path, name: nameOf(path) } }
    })
    if (stack.some((one, at) => one !== this.stack[at])) this.stack = stack
  }

  /** A note's file says all its document does: an entry made from that document holds
   *  what is on the disk or older, and coming back with those is a write of them over
   *  whatever the file says by then, an agent's edit or a sync pull. From here on it comes
   *  back from its file, as a tab with nothing unwritten does. Only that document's: the
   *  words of another at the path may have been refused, and these say nothing of them. */
  wroteAll(path: string, key: string) {
    const stack = this.stack.map((closed) =>
      closed.draft.dirty && closed.draft.share === key && samePath(closed.draft.path, path)
        ? { ...closed, draft: { ...closed.draft, dirty: false, doc: '' } }
        : closed,
    )
    if (stack.some((one, at) => one !== this.stack[at])) this.stack = stack
  }

  /** What the session had written down, oldest first. Trimmed on the way in as
   *  well as on the way out: an entry written by a build that kept more of them
   *  should not make this one carry more than it means to. */
  restore(closed: readonly ClosedTab[]) {
    this.stack = closed.slice(-MOST_CLOSED)
  }
}
