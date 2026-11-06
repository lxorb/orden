import { successor } from './recency'
import { identifier } from '../identifier'
import {
  type Along,
  canSplit,
  clamped,
  EQUAL,
  type Frame,
  nextPane,
  paneToward,
  type Toward,
  pane,
  type Pane,
  paneIn,
  panesIn,
  splitIn,
  withoutPane,
  withSplit,
} from './pane-tree'
import type { Zone } from './zones'

export type Landing =
  { kind: 'strip'; paneId: string; at: number } | { kind: 'pane'; paneId: string; zone: Zone }

export interface Dragging {
  tabId: string | null
}

export class Panes {
  frame = $state<Frame>(pane(identifier()))
  focusedId = $state('')
  fills = $state<string | null>(null)
  swapping = false
  used: string[] = []

  sliding = $state<string | null>(null)

  dragging = $state<Dragging | null>(null)

  landing = $state<Landing | null>(null)

  dragged(what: Dragging) {
    this.settled()
    this.dragging = what

    const done = () => {
      this.settled()
      this.dragging = null
      this.landing = null
    }

    window.addEventListener('dragend', done, { once: true })
    window.addEventListener('drop', done, { once: true })
    this.settling = () => {
      window.removeEventListener('dragend', done)
      window.removeEventListener('drop', done)
    }
  }

  dropped() {
    this.settled()
    this.dragging = null
    this.landing = null
  }

  private settled() {
    this.settling?.()
    this.settling = null
  }

  private settling: (() => void) | null = null

  private readonly changed: () => void

  constructor(changed: () => void) {
    const first = pane(identifier())
    this.frame = first
    this.focusedId = first.id
    this.changed = changed
  }

  readonly all: Pane[] = $derived(panesIn(this.frame))
  readonly count: number = $derived(this.all.length)

  readonly focused: Pane = $derived.by(() => {
    const [first] = this.all
    return paneIn(this.frame, this.focusedId) ?? first ?? pane(this.focusedId)
  })

  at(id: string): Pane | null {
    return paneIn(this.frame, id)
  }

  focus(id: string) {
    if (id === this.focusedId || !paneIn(this.frame, id)) return

    this.focusedId = id
    this.changed()
  }

  focusNext() {
    const next = nextPane(this.frame, this.focusedId)
    if (next) this.focus(next.id)
  }

  focusToward(toward: Toward): Pane | null {
    const next = paneToward(this.frame, this.focusedId, toward)
    if (next) this.focus(next.id)
    return next
  }

  splittable(along: Along, id: string = this.focusedId): boolean {
    return canSplit(this.frame, id, along)
  }

  split(along: Along, id: string = this.focusedId, near = false): Pane | null {
    if (!canSplit(this.frame, id, along)) return null

    const made = pane(identifier())
    this.frame = withSplit(this.frame, id, along, made, identifier(), near)
    this.focusedId = made.id
    this.changed()

    return paneIn(this.frame, made.id)
  }

  close(id: string): boolean {
    if (this.count < 2) return false

    this.frame = withoutPane(this.frame, id)
    if (!paneIn(this.frame, this.focusedId)) this.focusedId = this.all[0]?.id ?? this.focusedId

    this.changed()
    return true
  }

  resize(id: string, fraction: number, room: number) {
    const split = splitIn(this.frame, id)
    if (split) split.fraction = clamped(fraction, room)
  }

  settle() {
    this.sliding = null
    this.changed()
  }

  equalise(id: string) {
    const split = splitIn(this.frame, id)
    if (!split || split.fraction === EQUAL) return

    split.fraction = EQUAL
    this.changed()
  }

  setLinked(id: string, on: boolean) {
    const one = paneIn(this.frame, id)
    if (!one || one.linked === on) return

    one.linked = on
    this.changed()
  }

  setStacked(id: string, on: boolean) {
    const one = paneIn(this.frame, id)
    if (!one || one.stacked === on) return

    one.stacked = on
    this.changed()
  }

  activate(id: string, tabId: string | null) {
    const one = paneIn(this.frame, id)
    if (!one || one.activeTabId === tabId) return

    one.activeTabId = tabId
    if (tabId) this.usedNow(tabId)
    this.changed()
  }

  deselect(id: string) {
    const was = paneIn(this.frame, id)?.activeTabId
    if (!was) return

    this.usedNow(was)
    this.activate(id, null)
  }

  lastOf(strip: readonly string[]): string | null {
    return this.used.find((id) => strip.includes(id)) ?? null
  }

  successorOf(left: readonly string[], at?: number): string | null {
    return successor(left, this.used, at)
  }

  arrived(tabIds: readonly string[]) {
    for (const id of tabIds) this.usedNow(id)
  }

  recall(order: readonly string[]) {
    this.used = [...this.used, ...order.filter((id) => !this.used.includes(id))].slice(0, 200)
  }

  private usedNow(tabId: string) {
    this.used = [tabId, ...this.used.filter((one) => one !== tabId)].slice(0, 200)
  }

  collapse() {
    if (this.count < 2) return

    const kept = this.focused
    this.frame = pane(kept.id, kept.activeTabId)
    this.focusedId = kept.id
    this.changed()
  }

  restore(frame: Frame, focusedId: string) {
    this.frame = frame
    this.focusedId = paneIn(frame, focusedId) ? focusedId : (panesIn(frame)[0]?.id ?? focusedId)
  }
}
