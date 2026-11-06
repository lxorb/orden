import { movedTo, nameOf, samePath, within } from '../space-paths'
import { unixLines } from './documents.svelte'
import type { FileOp } from './file-ops'
import type { ClosedTab, Draft } from './session'

export const MOST_CLOSED = 20

export class ClosedTabs {
  stack = $state<ClosedTab[]>([])

  readonly any = $derived(this.stack.length > 0)

  record(closed: ClosedTab) {
    this.stack = [...this.stack, closed].slice(-MOST_CLOSED)
  }

  take(): ClosedTab[] {
    const last = this.stack.at(-1)
    if (!last) return []

    let from = this.stack.length - 1
    while (last.batch !== undefined && this.stack[from - 1]?.batch === last.batch) from -= 1

    const taken = this.stack.slice(from).reverse()
    this.stack = this.stack.slice(0, from)
    return taken
  }

  follow(op: FileOp) {
    if (op.op === 'removed') {
      const path = op.path
      this.remade((closed) => {
        const at = closed.draft.path
        if (at === null || within(path, at) === null || !closed.draft.dirty) return closed
        const draft: Draft = { ...closed.draft, path: null }
        delete draft.base
        return { ...closed, draft }
      })
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

  wroteAll(path: string, key: string, words: string) {
    this.remade((closed) => {
      if (!closed.draft.dirty || !samePath(closed.draft.path, path)) return closed
      if (closed.draft.share !== key && unixLines(closed.draft.doc) !== unixLines(words))
        return closed
      const draft: Draft = { ...closed.draft, dirty: false, doc: '' }
      delete draft.base
      return { ...closed, draft }
    })
  }

  private remade(change: (closed: ClosedTab) => ClosedTab) {
    const stack = this.stack.map(change)
    if (stack.some((one, at) => one !== this.stack[at])) this.stack = stack
  }

  restore(closed: readonly ClosedTab[]) {
    this.stack = closed.slice(-MOST_CLOSED)
  }
}
