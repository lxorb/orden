import type { FileAction, OutsideStep } from './workspace/undo.svelte'

export type Said = 'done' | 'scheduled' | 'moved' | 'deleted'

const told = new WeakMap<FileAction, Said>()

type Offered = FileAction

type Told = 'delete' | 'move' | 'archive' | 'unarchive' | Said

function toldOf(action: Offered): Told {
  const one = headOf(action)
  if (one.kind === 'replace') return told.get(one) ?? 'done'
  if (one.kind === 'outside') return outsideTold(one.steps) ?? 'move'
  return one.kind as Exclude<Told, Said>
}

function headOf(action: FileAction): FileAction {
  return action.kind === 'many' ? (action.steps[0] ?? action) : action
}

export const UNDO_LINGER = 6_000

function offered(action: FileAction): boolean {
  action = headOf(action)
  return (
    action.kind === 'delete' ||
    action.kind === 'move' ||
    action.kind === 'archive' ||
    action.kind === 'unarchive' ||
    (action.kind === 'replace' && told.has(action)) ||
    (action.kind === 'outside' && outsideTold(action.steps) !== null)
  )
}

function outsideTold(steps: readonly OutsideStep[]): 'delete' | 'move' | null {
  const step = steps.find((one) => one.op !== 'replaced')
  if (step?.op === 'trashed') return 'delete'
  if (step?.op === 'moved') return 'move'
  return null
}

export function nextBatch(
  batch: readonly FileAction[],
  fresh: readonly FileAction[],
  stack: readonly FileAction[],
): Offered[] {
  let next = batch.filter((action) => offered(action) && stack.includes(action))

  for (const action of fresh) {
    if (!offered(action)) next = []
    else if (next[0] && toldOf(next[0]) === toldOf(action)) next = [...next, action]
    else next = [action]
  }

  const top = stack.at(-1)
  return top !== undefined && next.at(-1) === top ? next : []
}

interface Undoable {
  readonly undone: { readonly stack: readonly FileAction[]; readonly last: FileAction | undefined }
  undoFileAction(only?: FileAction): Promise<void>
}

class UndoToast {
  batch = $state<Offered[]>([])

  private seen = new WeakSet<FileAction>()
  private timer: ReturnType<typeof setTimeout> | undefined

  get kind(): Told | null {
    const first = this.batch[0]
    return first ? toldOf(first) : null
  }

  know(stack: readonly FileAction[]) {
    for (const action of stack) this.seen.add(action)
  }

  tell(action: FileAction, said: Said, stack: readonly FileAction[]) {
    told.set(action, said)
    if (stack.at(-1) !== action) return
    const first = this.batch[0]
    const along = first && toldOf(first) === said && stack.includes(first)
    this.batch = along ? [...this.batch, action] : [action]
    this.linger()
  }

  heard(stack: readonly FileAction[]) {
    const fresh = stack.filter((action) => !this.seen.has(action))
    this.know(fresh)

    this.batch = nextBatch(this.batch, fresh, stack)
    if (fresh.length && this.batch.length) this.linger()
    else if (!this.batch.length) this.stop()
  }

  async undo(from: Undoable) {
    const batch = this.batch
    this.dismiss()

    for (const action of [...batch].reverse()) {
      if (from.undone.last !== action) return
      await from.undoFileAction(action)
    }
  }

  dismiss() {
    this.batch = []
    this.stop()
  }

  hold() {
    this.stop()
  }

  linger() {
    this.stop()
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  private stop() {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

export const undoToast = new UndoToast()
