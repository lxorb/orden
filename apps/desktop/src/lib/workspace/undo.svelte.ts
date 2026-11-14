import type { Edit } from '../search/replace'
import type { Bookmark } from './bookmarks.svelte'

export type FileAction =
  | {
      kind: 'move' | 'rename'
      from: string
      to: string
      rewrote?: boolean
      follows?: boolean
      nests?: boolean
      carries?: boolean
    }
  | {
      kind: 'delete'
      path: string
      content: string
      trashId?: string
      trashedAt?: { path: string; root: string }
      back?: string
      folder?: boolean
      notes?: { path: string; content: string }[]
      folders?: string[]
    }
  | { kind: 'create'; path: string; content?: string; trashId?: string; back?: string }
  | { kind: 'many'; steps: FileAction[] }
  | { kind: 'keep'; root: string; before: Bookmark[]; after: Bookmark[] }
  | {
      kind: 'merge'
      from: string
      fromContent: string
      into: string
      intoContent: string
      intoAfter: string
      relinked?: string[]
    }
  | {
      kind: 'split' | 'extract'
      from: string
      fromContent: string
      fromAfter: string
      created: string
      createdContent: string
    }
  | {
      kind: 'replace'
      notes: { path: string; content: string; after: string; edits: Edit[] }[]
    }
  | { kind: 'import'; paths: string[]; wrote: Record<string, string> }
  | { kind: 'copy'; made: Copied[] }
  | {
      kind: 'archive' | 'unarchive'
      root: string
      archived: string[]
      restored: string[]
      closed: string[]
    }
  | { kind: 'outside'; steps: OutsideStep[] }

export type OutsideStep =
  | { op: 'moved' | 'copied'; pairs: { from: string; to: string }[] }
  | { op: 'made'; path: string; ticket?: OutsideTicket }
  | { op: 'trashed' | 'replaced'; tickets: OutsideTicket[] }

export interface OutsideTicket {
  path: string
  back: string
  at: number
}

export type Kept = Omit<Extract<FileAction, { kind: 'delete' }>, 'kind' | 'path'>

export interface Binning {
  source?: string | undefined
  madeHere?: boolean
  settled?: boolean
}

export interface Copied {
  path: string
  folder: boolean
  from?: string
}

import { shownName, folderOf, nameOf, samePath } from '../platform/src/api'
import type { FileOp } from './file-ops'

const KEPT = 20

export const LANDS_WITHIN = 10_000

export class FileActions {
  stack = $state<FileAction[]>([])

  get last(): FileAction | undefined {
    return this.stack.at(-1)
  }

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

  #held: FileAction[] | null = null

  async batch<T>(work: () => Promise<T>): Promise<T> {
    this.#under += 1
    try {
      if (this.#held) return await work()
      const held: FileAction[] = (this.#held = [])
      try {
        return await work()
      } finally {
        this.#held = null
        const [only, ...more] = held
        if (only) this.record(more.length ? { kind: 'many', steps: held } : only)
      }
    } finally {
      this.#under -= 1
      if (!this.#under) {
        this.#overdue = false
        for (const go of this.#waiting.splice(0)) go()
      }
    }
  }

  #under = 0
  #waiting: (() => void)[] = []
  #overdue = false

  landed(): Promise<boolean> {
    if (!this.#under) return Promise.resolve(true)
    if (this.#overdue) return Promise.resolve(false)
    return new Promise((go) => {
      const late = setTimeout(() => {
        this.#overdue = true
        go(false)
      }, LANDS_WITHIN)
      this.#waiting.push(() => {
        clearTimeout(late)
        go(true)
      })
    })
  }

  async follow(op: FileOp) {
    if (op.op !== 'moved' || (!op.heard && op.kind !== 'space')) return
    const { heardMove } = await import('./undo-moved')
    heardMove(this.steps, op)
  }

  async moved(from: string, to: string) {
    const { rewritten } = await import('./undo-moved')
    for (const action of this.steps) rewritten(action, from, to)
  }

  private get steps(): FileAction[] {
    return [...this.stack, ...this.ahead, ...(this.#held ?? [])]
  }

  giveUp(action: FileAction) {
    this.stack = this.stack.filter((one) => one !== action)
  }

  drop() {
    const last = this.last
    this.stack = this.stack.slice(0, -1)
    if (last) this.ahead = doesAgain(last) ? [...this.ahead, last] : []
  }

  redone(rest: FileAction[]) {
    this.ahead = rest
  }

  trashed(path: string, id: string) {
    const last = this.#held?.at(-1) ?? this.last
    const step = last?.kind === 'many' ? last.steps.at(-1) : last
    if (step?.kind === 'delete' && samePath(step.path, path)) step.trashId = id
  }

  forget(trashId: string) {
    const kept = (action: FileAction) => action.kind !== 'delete' || action.trashId !== trashId
    this.stack = this.stack.flatMap((action): FileAction[] => {
      if (action.kind !== 'many') return kept(action) ? [action] : []
      const steps = action.steps.filter(kept)
      return steps.length ? [{ kind: 'many' as const, steps }] : []
    })
  }

  get label(): string | null {
    return labelOf(this.last)
  }

  get canRedo(): boolean {
    return this.next !== undefined
  }
}

function labelOf(action: FileAction | undefined): string | null {
  if (!action) return null

  switch (action.kind) {
    case 'move':
      return `Undo moving ${shownName(nameOf(action.to))}`
    case 'rename':
      return `Undo renaming ${shownName(nameOf(action.to))}`
    case 'delete':
      return `Undo deleting ${shownName(nameOf(action.path))}`
    case 'merge':
      return `Undo merging ${shownName(nameOf(action.from))}`
    case 'split':
      return `Undo splitting ${shownName(nameOf(action.from))}`
    case 'extract':
      return `Undo extracting from ${shownName(nameOf(action.from))}`
    case 'replace':
      return 'Undo the replacement'
    case 'import':
      return 'Undo the import'
    case 'copy':
      return 'Undo the copy'
    case 'archive':
      return `Undo archiving ${shownName(nameOf(action.archived[0] ?? ''))}`
    case 'unarchive':
      return `Undo unarchiving ${shownName(nameOf(action.restored.at(-1) ?? ''))}`
    case 'create':
      return `Undo making ${shownName(nameOf(action.path))}`
    case 'outside':
      return outsideLabel(action.steps)
    case 'keep':
      return 'Undo the move'
    case 'many': {
      const [first] = action.steps
      if (!action.steps.every((one) => one.kind === first?.kind)) return labelOf(first)
      if (first?.kind === 'delete') return 'Undo the deletion'
      if (first?.kind === 'move') return 'Undo the move'
      return labelOf(first)
    }
  }
}

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
    case 'outside':
      return true
    case 'merge':
    case 'split':
    case 'extract':
    case 'replace':
    case 'import':
      return false
  }
}

function outsideLabel(steps: readonly OutsideStep[]): string | null {
  const step = steps.find((one) => one.op !== 'replaced')
  if (!step) return null
  switch (step.op) {
    case 'moved': {
      const [only, ...more] = step.pairs
      if (!only || more.length) return 'Undo the move'
      return samePath(folderOf(only.from), folderOf(only.to))
        ? `Undo renaming ${nameOf(only.to)}`
        : `Undo moving ${nameOf(only.to)}`
    }
    case 'copied':
      return 'Undo the copy'
    case 'made':
      return `Undo making ${nameOf(step.path)}`
    case 'trashed':
    case 'replaced': {
      const [only, ...more] = step.tickets
      return only && !more.length ? `Undo deleting ${nameOf(only.path)}` : 'Undo the deletion'
    }
  }
}

let sidebarLast = false

export function used(target: EventTarget | null) {
  if (!(target instanceof Element) || target.matches('body,html')) return
  if (target.closest('[data-sidebar]')) {
    sidebarLast = !target.closest('[data-panel]:not([data-panel=tree])')
  } else if (!target.closest('[role=menu],[role=dialog],[role=status],[role=tooltip]')) {
    sidebarLast = false
  }
}

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
