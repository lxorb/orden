import { untrack } from 'svelte'
import { HeldState, letGo, type SharedDoc, type StateEffect, type StateView } from '@orden/editor'

const FOLD_AFTER = 24

export interface NoteTab {
  readonly note: { readonly live: SharedDoc; readonly arrivals: number }
}
interface Kept {
  readonly note: NoteTab['note']
  readonly arrivals: number
  readonly state: HeldState
  stamp: string | undefined
}
function noteOf(tab: NoteTab): { note: NoteTab['note']; arrivals: number } {
  return untrack(() => ({ note: tab.note, arrivals: tab.note.arrivals }))
}
export class Handoff {
  private owed = false
  private to: { focus(): void } | null = null
  left() {
    if (this.to) this.to.focus()
    else this.owed = true
    queueMicrotask(() => (this.owed = false))
  }
  came(view: { focus(): void }) {
    if (this.owed) view.focus()
    else this.to = view
    this.owed = false
    queueMicrotask(() => (this.to = null))
  }
}
export class Parked<T extends NoteTab = NoteTab> {
  private readonly kept = new Map<T, Kept>()
  private open = true
  constructor(private readonly wanted: (tab: T) => boolean) {}
  put(tab: T, one: Kept) {
    if (this.open && this.wanted(tab)) this.kept.set(tab, one)
    else one.state.release()
  }
  claim(tab: T): Kept | undefined {
    const one = this.kept.get(tab)
    this.kept.delete(tab)
    return one
  }
  shut() {
    this.open = false
    this.keepOnly([])
  }
  keepOnly(tabs: readonly T[]) {
    const kept = new Set(tabs)
    for (const [tab, one] of this.kept) {
      if (kept.has(tab)) continue
      one.state.release()
      this.kept.delete(tab)
    }
  }
}
export class EditorStates {
  private readonly held = new Map<NoteTab, Kept>()
  private shown: Kept | null = null
  private settled = false
  get count(): number {
    return this.held.size
  }
  shows(tab: NoteTab): boolean {
    const note = tab.note
    const arrivals = note.arrivals
    const kept = this.held.get(tab)
    return kept !== undefined && kept === this.shown && kept.note === note && kept.arrivals === arrivals
  }
  started(tab: NoteTab, view: StateView, place: StateEffect<unknown> | null) {
    const on = noteOf(tab)
    const kept: Kept = {
      note: on.note,
      arrivals: on.arrivals,
      state: HeldState.shownIn(on.note.live, view, place),
      stamp: undefined,
    }
    this.held.set(tab, kept)
    this.shown = kept
  }
  fitted(tab: NoteTab): string | undefined {
    return this.held.get(tab)?.stamp
  }
  fit(tab: NoteTab, stamp: string) {
    const kept = this.held.get(tab)
    if (kept) kept.stamp = stamp
  }
  show(view: StateView, tab: NoteTab, build: () => HeldState, effects: readonly StateEffect<unknown>[] = []): boolean {
    const on = noteOf(tab)
    const had = this.held.get(tab)
    const moved = had && (had.note !== on.note || had.arrivals !== on.arrivals)
    const stale = moved ? had : undefined
    const known = stale ? undefined : had
    const next = known ?? ({ note: on.note, arrivals: on.arrivals, state: build(), stamp: undefined } satisfies Kept)
    if (!known) this.held.set(tab, next)
    if (this.shown === next) {
      if (this.settled) {
        if (effects.length) view.dispatch({ effects: [...effects] })
      } else next.state.settle(view, effects)
      this.settled = true
      return !known
    }
    this.shown?.state.take(view)
    this.shown = next
    this.settled = true
    next.state.give(view, effects)
    stale?.state.release()
    return !known
  }
  keepOnly(tabs: readonly NoteTab[]) {
    const kept = new Set(tabs)
    for (const [tab, one] of this.held) {
      if (one === this.shown || kept.has(tab)) continue
      one.state.release()
      this.held.delete(tab)
    }
  }
  resumed<T extends NoteTab>(tab: T, from: Parked<T>): boolean {
    const one = from.claim(tab)
    if (!one) return false
    const on = noteOf(tab)
    if (one.note !== on.note || one.arrivals !== on.arrivals) {
      one.state.release()
      return false
    }
    this.held.set(tab, one)
    return true
  }
  park<T extends NoteTab>(view: StateView, into: Parked<T>) {
    const shown = this.shown
    for (const [tab, one] of this.held) {
      if (one !== shown) continue
      one.state.take(view)
      this.held.delete(tab)
      this.shown = null
      into.put(tab as T, one)
    }
    this.releaseAll(view)
  }
  releaseAll(view: StateView) {
    for (const one of this.held.values()) {
      if (one !== this.shown) one.state.release()
    }
    letGo(view)
    this.held.clear()
    this.shown = null
    this.settled = false
  }
}
interface Folding {
  readonly scrollDOM: HTMLElement
  readonly contentDOM: HTMLElement
  readonly hasFocus: boolean
  readonly composing: boolean
  readonly state: { readonly selection: { readonly main: { readonly empty: boolean } } }
}
export function foldsKeyboard(view: Folding): () => void {
  let from: number | null = null
  const start = (event: TouchEvent) => {
    from = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null
  }
  const move = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY
    if (from === null || y === undefined || y - from < FOLD_AFTER) return
    from = null
    if (view.hasFocus && !view.composing && view.state.selection.main.empty) view.contentDOM.blur()
  }
  const end = () => (from = null)
  const scroller = view.scrollDOM
  scroller.addEventListener('touchstart', start, { passive: true })
  scroller.addEventListener('touchmove', move, { passive: true })
  scroller.addEventListener('touchend', end)
  scroller.addEventListener('touchcancel', end)
  return () => {
    scroller.removeEventListener('touchstart', start)
    scroller.removeEventListener('touchmove', move)
    scroller.removeEventListener('touchend', end)
    scroller.removeEventListener('touchcancel', end)
  }
}
