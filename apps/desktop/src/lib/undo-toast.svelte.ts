/** The short "Undo" that follows a file somebody deleted or moved.
 *
 *  The way Gmail and Notion do it: the thing is gone at once, and for a few seconds
 *  one press brings it back. Before it, the only way back was an Undo row at the foot
 *  of a row's menu, which nobody looks for straight after a delete they did not mean.
 *
 *  Nothing is kept here that the undo stack does not already keep. The toast offers
 *  the actions at the top of `workspace.undone`, and taking them back is the same
 *  `undoFileAction` Ctrl+Z and the palette run - so the toast and they can never
 *  disagree, and an undo from either takes the toast's action off it too.
 *
 *  One press for one gesture. Deleting or moving a selection is one action of several
 *  steps (`many` in workspace/undo.svelte.ts), told as the kind of its first; and
 *  actions of the same kind arriving while the toast is up join it, and Undo takes all
 *  of them back. A different kind of action is a different gesture and starts again. */

import type { FileAction } from './workspace/undo.svelte'

/** What a view's write to tasks was: completed, scheduled, moved, deleted. */
export type Said = 'done' | 'scheduled' | 'moved' | 'deleted'

/** The writes a view told the toast about (`tell`), with the word for each. Kept here
 *  rather than on the action, so the undo stack, which the first paint carries, stays
 *  as it was. */
const told = new WeakMap<FileAction, Said>()

/** What the toast is about: a delete, a move, a row archived or taken back out, or what
 *  a view did to tasks, or a gesture of several that began with one of those. Everything
 *  else on the stack is taken back from the menus. */
type Offered = FileAction

/** The word the toast says, one for each thing it can take back. */
type Told = 'delete' | 'move' | 'archive' | 'unarchive' | Said

/** What one offered action is told as. */
function toldOf(action: Offered): Told {
  const one = headOf(action)
  if (one.kind === 'replace') return told.get(one) ?? 'done'
  return one.kind as Exclude<Told, Said>
}

/** The step a gesture of several began with, which is what it is told as. */
function headOf(action: FileAction): FileAction {
  return action.kind === 'many' ? (action.steps[0] ?? action) : action
}

/** How long it stays, unless the pointer is on it. Long enough to read one word and
 *  reach for it; Gmail's is about the same. Here rather than in backoff.ts because
 *  that module is in front of the first paint and this one is not. */
export const UNDO_LINGER = 6_000

function offered(action: FileAction): boolean {
  action = headOf(action)
  return (
    action.kind === 'delete' ||
    action.kind === 'move' ||
    action.kind === 'archive' ||
    action.kind === 'unarchive' ||
    (action.kind === 'replace' && told.has(action))
  )
}

/** What the toast offers once the stack reads `stack`, having offered `batch`, where
 *  `fresh` are the actions that arrived since it last looked, oldest first.
 *
 *  Pure, so the rule can be read and tested apart from any timer. An action somebody
 *  took back some other way has gone from the stack and goes from the batch; an
 *  action of another kind on top of the stack means Undo would no longer reach the
 *  batch, so there is nothing to offer. */
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

/** What the undo stack has to give the toast. */
interface Undoable {
  readonly undone: { readonly stack: readonly FileAction[]; readonly last: FileAction | undefined }
  undoFileAction(): Promise<void>
}

class UndoToast {
  batch = $state<Offered[]>([])

  /** Every action the toast has looked at, so an older one coming back to the top
   *  of the stack - after an undo - is not taken for a new one. */
  private seen = new WeakSet<FileAction>()
  private timer: ReturnType<typeof setTimeout> | undefined

  /** Which kind the toast is about, or null when it is not up. */
  get kind(): Told | null {
    const first = this.batch[0]
    return first ? toldOf(first) : null
  }

  /** What was on the stack before anybody did anything: none of it is news. */
  know(stack: readonly FileAction[]) {
    for (const action of stack) this.seen.add(action)
  }

  /** A view's write, on the stack already, and the word for it: offered now, beside
   *  others of its word still up. The stack heard of it first, before it had one. */
  tell(action: FileAction, said: Said, stack: readonly FileAction[]) {
    told.set(action, said)
    if (stack.at(-1) !== action) return
    const first = this.batch[0]
    const along = first && toldOf(first) === said && stack.includes(first)
    this.batch = along ? [...this.batch, action] : [action]
    this.linger()
  }

  /** The stack has changed. */
  heard(stack: readonly FileAction[]) {
    const fresh = stack.filter((action) => !this.seen.has(action))
    this.know(fresh)

    this.batch = nextBatch(this.batch, fresh, stack)
    if (fresh.length && this.batch.length) this.linger()
    else if (!this.batch.length) this.stop()
  }

  /** Takes the whole batch back, newest first, for as long as the newest is still
   *  the one on top: something else done in between is not the toast's to undo. */
  async undo(from: Undoable) {
    const batch = this.batch
    this.dismiss()

    for (const action of [...batch].reverse()) {
      if (from.undone.last !== action) return
      await from.undoFileAction()
    }
  }

  dismiss() {
    this.batch = []
    this.stop()
  }

  /** Held while the pointer is on it, so a hand on its way to Undo is not beaten to
   *  it by the clock. */
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
