/** The last handful of file operations, so one can be taken back.
 *
 *  Not persisted: putting a file back only makes sense while it is fresh, and
 *  an entry that survived a restart would be offering to undo something the
 *  reader had long forgotten. */

import { t } from '../i18n.svelte'
import type { Edit } from '../search/replace'
import type { Bookmark } from './bookmarks.svelte'

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
      /** Caused by the step before (an unnesting), or made its folder (a nesting). */
      follows?: boolean
      nests?: boolean
    }
  | {
      kind: 'delete'
      path: string
      content: string
      trashId?: string
      /** Signed in, a folder's words and folders as it went. */
      folder?: boolean
      notes?: { path: string; content: string }[]
      folders?: string[]
    }
  /** A file made; what Recently deleted kept of it once undone (#399). */
  | { kind: 'create'; path: string; content?: string; trashId?: string }
  /** One gesture of several operations (#399). */
  | { kind: 'many'; steps: FileAction[] }
  /** A space's Essentials as they were and became (#412). */
  | { kind: 'keep'; root: string; before: Bookmark[]; after: Bookmark[] }
  /** The composer's three, each recorded with the text it replaced: what those
   *  do is edit two notes at once, and an edit is not a file operation the
   *  filesystem can put back. */
  | { kind: 'merge'; from: string; fromContent: string; into: string; intoContent: string }
  | { kind: 'split' | 'extract'; from: string; fromContent: string; created: string }
  /** A replacement run across the space. However many notes it touched, it is
   *  one thing somebody did and so one thing to take back. Each note keeps the
   *  words it had, the edits that put them back and the words those edits are
   *  measured against - what the replacement left - so a note open in a pane gets
   *  its old words the way it got the new ones and keeps its caret, and what was
   *  typed since the replacement is carried rather than written over. */
  | {
      kind: 'replace'
      notes: { path: string; content: string; after: string; edits: Edit[] }[]
    }
  /** An import. However many files it wrote, what somebody did was import once,
   *  so it is one thing to take back. The paths alone: undoing is removing files
   *  that were not there a minute ago, and a file nobody has touched yet needs no
   *  snapshot kept of it. */
  | { kind: 'import'; paths: string[] }
  /** A paste, a Ctrl-drag, a duplicate or files dropped in: one thing to take
   *  back however many it made. Where each landed, and what it was copied from so
   *  it can be made again - which a file from outside the app has not got. */
  | { kind: 'copy'; made: Copied[] }
  /** Rows archived or taken back: which paths went each way, and the tabs archiving
   *  closed, so Undo opens them again. See archiving.ts. */
  | {
      kind: 'archive' | 'unarchive'
      root: string
      archived: string[]
      restored: string[]
      closed: string[]
    }

export type Kept = Omit<Extract<FileAction, { kind: 'delete' }>, 'kind' | 'path'>

export interface Copied {
  path: string
  folder: boolean
  from?: string
}

import { shownName } from '../note-name'
import { nameOf, samePath } from '../space-paths'

/** Twenty is far more than anyone reaches back through, and stops a long
 *  session from holding the text of every note it ever deleted. */
const KEPT = 20

export class FileActions {
  /** Newest last. Read by the tree's menu and by the trash, which drops an
   *  entry whose copy it has just restored itself. */
  stack = $state<FileAction[]>([])

  get last(): FileAction | undefined {
    return this.stack.at(-1)
  }

  /** What was taken back and can be done again, newest last. Anything new done
   *  empties it, as every redo does. */
  ahead = $state<FileAction[]>([])

  get next(): FileAction | undefined {
    return this.ahead.at(-1)
  }

  record(action: FileAction) {
    if (this.#held) {
      this.#held.push(action)
      return
    }
    this.stack = [...this.stack, action].slice(-KEPT)
    this.ahead = []
  }

  /** What `work` records, as one step. */
  #held: FileAction[] | null = null

  async batch<T>(work: () => Promise<T>): Promise<T> {
    if (this.#held) return work()
    const held: FileAction[] = (this.#held = [])
    try {
      return await work()
    } finally {
      this.#held = null
      const [only, ...more] = held
      if (only) this.record(more.length ? { kind: 'many', steps: held } : only)
    }
  }

  /** Drops the newest one, once it has actually been put back, and keeps it to do
   *  again where that means something; one that cannot be ends the redo there. */
  drop() {
    const last = this.last
    this.stack = this.stack.slice(0, -1)
    if (last) this.ahead = doesAgain(last) ? [...this.ahead, last] : []
  }

  /** A redo recorded itself, which emptied what was ahead; this puts the rest back. */
  redone(rest: FileAction[]) {
    this.ahead = rest
  }

  /** The trash id of a deletion, once the trash has answered with one. */
  trashed(path: string, id: string) {
    const last = this.#held?.at(-1) ?? this.last
    const step = last?.kind === 'many' ? last.steps.at(-1) : last
    if (step?.kind === 'delete' && samePath(step.path, path)) step.trashId = id
  }

  /** Everything except the deletion whose copy has been restored some other
   *  way - from Recently deleted, say. Undoing it again would write the
   *  snapshot over the note that is now back. */
  forget(trashId: string) {
    const kept = (action: FileAction) => action.kind !== 'delete' || action.trashId !== trashId
    this.stack = this.stack.flatMap((action): FileAction[] => {
      if (action.kind !== 'many') return kept(action) ? [action] : []
      const steps = action.steps.filter(kept)
      return steps.length ? [{ kind: 'many' as const, steps }] : []
    })
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing.
   *
   *  The name as the row beside it says the name, which is without the ending a
   *  document is known by: the palette and a tag's menu say it beside the file
   *  list, and "Undo renaming Plan.md" beside a row that reads `Plan` is the app
   *  disagreeing with itself. See note-name.ts. */
  get label(): string | null {
    return labelOf(this.last)
  }

  /** Whether there is anything to do again. */
  get canRedo(): boolean {
    return this.next !== undefined
  }
}

/** What undoing `action` would do, phrased for a menu. A gesture of several is said
 *  as the one kind it was, or as its first step where it mixed them. */
function labelOf(action: FileAction | undefined): string | null {
  if (!action) return null

  switch (action.kind) {
    case 'move':
      return t('Undo moving {name}', { name: shownName(nameOf(action.to)) })
    case 'rename':
      return t('Undo renaming {name}', { name: shownName(nameOf(action.to)) })
    case 'delete':
      return t('Undo deleting {name}', { name: shownName(nameOf(action.path)) })
    case 'merge':
      return t('Undo merging {name}', { name: shownName(nameOf(action.from)) })
    case 'split':
      return t('Undo splitting {name}', { name: shownName(nameOf(action.from)) })
    case 'extract':
      return t('Undo extracting from {name}', { name: shownName(nameOf(action.from)) })
    case 'replace':
      return t('Undo the replacement')
    case 'import':
      return t('Undo the import')
    case 'copy':
      return t('Undo the copy')
    case 'archive':
      return t('Undo archiving {name}', { name: shownName(nameOf(action.archived[0] ?? '')) })
    case 'unarchive':
      return t('Undo unarchiving {name}', {
        name: shownName(nameOf(action.restored.at(-1) ?? '')),
      })
    case 'create':
      return t('Undo making {name}', { name: shownName(nameOf(action.path)) })
    case 'keep':
      return t('Undo the move')
    case 'many': {
      const [first] = action.steps
      if (!action.steps.every((one) => one.kind === first?.kind)) return labelOf(first)
      if (first?.kind === 'delete') return t('Undo the deletion')
      if (first?.kind === 'move') return t('Undo the move')
      return labelOf(first)
    }
  }
}

/** Whether an action can be done again from what it recorded: the composer's three
 *  and a replacement kept only the way back. */
function doesAgain(action: FileAction): boolean {
  switch (action.kind) {
    case 'move':
    case 'rename':
    case 'delete':
    case 'archive':
    case 'unarchive':
    case 'create':
    case 'keep':
      return true
    case 'many':
      return action.steps.every(doesAgain)
    case 'copy':
      return action.made.every((one) => one.from !== undefined)
    case 'merge':
    case 'split':
    case 'extract':
    case 'replace':
    case 'import':
      return false
  }
}

/** Whether a sidebar was the last thing pressed or typed in: Ctrl+Z is then its file
 *  actions', wherever the app has put the keyboard since (#399). Not a panel of a note's
 *  own: what Properties writes is the note's, and the note's to undo. */
let sidebarLast = false

export function used(target: EventTarget | null) {
  if (!(target instanceof Element) || target.matches('body,html')) return
  if (target.closest('[data-sidebar]')) {
    sidebarLast = !target.closest('[data-panel]:not([data-panel=tree])')
  }
  // A menu, a sheet, a toast: over everything, and whatever opened them's.
  else if (!target.closest('[role=menu],[role=dialog],[role=status],[role=tooltip]')) {
    sidebarLast = false
  }
}

/** Undo or Redo, where a key down is the sidebar's: asked on the way down, before a
 *  note handed the keyboard takes it, and never a field's. */
export function sidebarKey(event: KeyboardEvent, pressed: (id: string) => boolean) {
  const key =
    event.defaultPrevented || !sidebarLast
      ? null
      : pressed('edit.undo')
        ? 'undo'
        : pressed('edit.redo') || pressed('edit.redo.alt')
          ? 'redo'
          : null
  if (!key && !/^(Control|Meta|Shift|Alt|AltGraph|CapsLock)$/.test(event.key)) used(event.target)
  const field = event.target instanceof Element && event.target.closest('input,textarea,select')
  return field ? null : key
}
