/** The app's side of inbox-move.ts: when a space's old `Inbox.md` is looked at, and how
 *  the move reads, writes and deletes.
 *
 *  Once a space's rows are read, and again whenever a note at `Inbox.md` is written or
 *  arrives, a space at a time and never two runs at once. A space this account may only
 *  read is never touched, and a space on the account waits for a sync pass first, so
 *  the move sees what the other devices did before it (one may have moved the same note
 *  already). The rows hear the move as they hear any write. */

import { log } from '../log'
import { readIfThere } from '../read-if-there'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { chosenInbox, OLD_INBOX } from './inbox'
import { madeByOrden, type Moving, moveOldInbox } from './inbox-move'
import type { RowsChange } from './store'

/** How long a pass in the air is waited for, at most, before the move goes ahead: a
 *  sync that never answers holds nothing up for good. */
const LONGEST = 60_000

const moving: Moving = {
  read: readIfThere,
  async write(path, text, made) {
    // Made, it is "this note, made if it is not there yet" for the sync (create.ts).
    await writeFile(path, text)
    if (made) await workspace.fileCame(path, 'file')
  },
  async remove(path) {
    await workspace.bin(path, false)
    await workspace.fileGone(path, 'file')
    await workspace.loadTree()
  },
}

/** Waits for a sync pass to have had its turn, where the space is on the account. */
async function synced(root: string): Promise<void> {
  const { sync } = await import('../sync.svelte')
  if (sync.remoteIdFor(root) === null) return
  const until = Date.now() + LONGEST
  while (sync.passing && Date.now() < until) await new Promise((go) => setTimeout(go, 500))
  await Promise.race([
    sync.pass().catch(() => false),
    new Promise((go) => setTimeout(go, Math.max(0, until - Date.now()))),
  ])
}

/** Whether a space has an old inbox the move would take, asked before anything waits
 *  on a sync: a note of the reader's at `Inbox.md` is saved often, and is theirs. */
async function worthAMove(root: string): Promise<boolean> {
  const chosen = chosenInbox(root)
  if (chosen !== null && samePath(chosen, OLD_INBOX, root)) return false
  const words = await readIfThere(insideSpace(root, OLD_INBOX)).catch(() => null)
  return words !== null && madeByOrden(words)
}

const asked = new Set<string>()
let running: Promise<void> = Promise.resolve()

/** Looks at a space's old inbox, after whatever is looking already. */
export function lookAt(root: string): void {
  if (asked.has(root)) return
  asked.add(root)
  running = running
    .then(async () => {
      asked.delete(root)
      const { canWriteAt } = await import('../sharing.svelte')
      if (!canWriteAt(root) || !(await worthAMove(root))) return
      await synced(root)
      const moved = await moveOldInbox(root, moving)
      if (moved === 'moved') log('info', `inbox: ${root}/${OLD_INBOX} moved into the space's own`)
    })
    .catch((error: unknown) => {
      log('warn', `inbox: ${root}/${OLD_INBOX} not moved - ${String(error)}`)
    })
}

/** What the rows say, heard for the spaces and the notes that ask for a look. */
export function heard(change: RowsChange): void {
  if (change.path === null) {
    if (change.added.length || !change.removed.length) lookAt(change.root)
    return
  }
  if (samePath(change.path, OLD_INBOX, change.root) && change.added.length) lookAt(change.root)
}
