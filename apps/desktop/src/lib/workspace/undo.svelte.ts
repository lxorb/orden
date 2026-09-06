/** The last handful of file operations, so one can be taken back.
 *
 *  Not persisted: putting a file back only makes sense while it is fresh, and
 *  an entry that survived a restart would be offering to undo something the
 *  reader had long forgotten. Deleting a folder is not among them either - its
 *  contents are already gone, and there is no snapshot of a folder. */

import { t } from '../i18n.svelte'

export type FileAction =
  | { kind: 'move' | 'rename'; from: string; to: string }
  | { kind: 'delete'; path: string; content: string; trashId?: string }

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

    const name = basename(action.kind === 'delete' ? action.path : action.to)
    return {
      move: t('Undo moving {name}', { name }),
      rename: t('Undo renaming {name}', { name }),
      delete: t('Undo deleting {name}', { name }),
    }[action.kind]
  }
}
