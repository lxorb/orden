/** The last handful of file operations, so one can be taken back.
 *
 *  Not persisted: putting a file back only makes sense while it is fresh, and
 *  an entry that survived a restart would be offering to undo something the
 *  reader had long forgotten. Deleting a folder is not among them either - its
 *  contents are already gone, and there is no snapshot of a folder. */

import { t } from '../i18n.svelte'
import type { Edit } from '../search/replace'

export type FileAction =
  | {
      kind: 'move' | 'rename'
      from: string
      to: string
      /** Whether links to the note elsewhere in the space were rewritten with
       *  it, so undoing knows to rewrite them back. The old text is not kept:
       *  the reverse rename is the same rewrite the other way round, and holding
       *  a copy of every touched note would hold a whole space. */
      rewrote?: boolean
    }
  | { kind: 'delete'; path: string; content: string; trashId?: string }
  /** The composer's three, each recorded with the text it replaced: what those
   *  do is edit two notes at once, and an edit is not a file operation the
   *  filesystem can put back. */
  | { kind: 'merge'; from: string; fromContent: string; into: string; intoContent: string }
  | { kind: 'split' | 'extract'; from: string; fromContent: string; created: string }
  /** A replacement run across the space. However many notes it touched, it is
   *  one thing somebody did and so one thing to take back. Each note keeps the
   *  words it had and the edits that put them back, so a note open in a pane
   *  gets its old words the way it got the new ones and keeps its caret. */
  | { kind: 'replace'; notes: { path: string; content: string; edits: Edit[] }[] }

/** Twenty is far more than anyone reaches back through, and stops a long
 *  session from holding the text of every note it ever deleted. */
const KEPT = 20

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export class FileActions {
  /** Newest last. Read by the tree's menu and by the trash, which drops an
   *  entry whose copy it has just restored itself. */
  stack = $state<FileAction[]>([])

  get last(): FileAction | undefined {
    return this.stack.at(-1)
  }

  record(action: FileAction) {
    this.stack = [...this.stack, action].slice(-KEPT)
  }

  /** Drops the newest one, once it has actually been put back. */
  drop() {
    this.stack = this.stack.slice(0, -1)
  }

  /** The trash id of a deletion, once the trash has answered with one. */
  trashed(path: string, id: string) {
    const last = this.last
    if (last?.kind === 'delete' && last.path === path) last.trashId = id
  }

  /** Everything except the deletion whose copy has been restored some other
   *  way - from Recently deleted, say. Undoing it again would write the
   *  snapshot over the note that is now back. */
  forget(trashId: string) {
    this.stack = this.stack.filter(
      (action) => action.kind !== 'delete' || action.trashId !== trashId,
    )
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing. */
  get label(): string | null {
    const action = this.last
    if (!action) return null

    switch (action.kind) {
      case 'move':
        return t('Undo moving {name}', { name: basename(action.to) })
      case 'rename':
        return t('Undo renaming {name}', { name: basename(action.to) })
      case 'delete':
        return t('Undo deleting {name}', { name: basename(action.path) })
      case 'merge':
        return t('Undo merging {name}', { name: basename(action.from) })
      case 'split':
        return t('Undo splitting {name}', { name: basename(action.from) })
      case 'extract':
        return t('Undo extracting from {name}', { name: basename(action.from) })
      case 'replace':
        return t('Undo the replacement')
    }
  }
}
