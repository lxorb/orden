import { without } from '../records'
import type { Landing } from '../workspace/panes.svelte'
import { clampedStart, nearestSlot, reorderSlack } from './layout'

export const THRESHOLD = 10

export interface Press {
  tabId: string
  from: number
  along: number
  x: number
  y: number
  grab: number
  finger: boolean
}

export interface Frame {
  widths: readonly number[]
  room: number
}

export type Ending =
  | { kind: 'click' }
  | { kind: 'moved'; tabId: string; from: number; to: number }
  | { kind: 'out'; tabId: string }

export class TabDrag {
  tabId = $state<string | null>(null)
  from = $state(0)
  slot = $state(0)
  x = $state(0)
  out = $state(false)
  pointer = $state({ x: 0, y: 0 })

  private press: Press | null = null
  private turned = 0

  get on(): boolean {
    return this.tabId !== null
  }

  get pressing(): Press | null {
    return this.press
  }

  down(press: Press) {
    this.press = press
    this.turned = press.along
  }

  move(along: number, x: number, y: number, inside: boolean, frame: Frame): boolean {
    const press = this.press
    if (!press) return false
    this.pointer = { x, y }

    if (!this.on) {
      if (Math.hypot(x - press.x, y - press.y) <= THRESHOLD) return false

      this.tabId = press.tabId
      this.from = press.from
      this.slot = press.from
    }

    const width = frame.widths[press.from] ?? 0
    this.x = clampedStart(along - press.grab, width, frame.room)

    if (!inside) {
      this.out = true
      return true
    }

    const nearest = nearestSlot(frame.widths, press.from, this.x, this.slot)

    if (this.out) {
      this.out = false
      this.slot = nearest
      this.turned = along
    } else if (nearest !== this.slot && Math.abs(along - this.turned) > reorderSlack(width)) {
      this.slot = nearest
      this.turned = along
    }

    return true
  }

  release(): Ending {
    const tabId = this.tabId
    const ending: Ending =
      tabId === null
        ? { kind: 'click' }
        : this.out
          ? { kind: 'out', tabId }
          : { kind: 'moved', tabId, from: this.from, to: this.slot }

    this.clear()
    return ending
  }

  cancel() {
    this.clear()
  }

  private clear() {
    this.press = null
    this.tabId = null
    this.out = false
  }
}

export interface Strip {
  slotAt(clientX: number): number
  top(): number
}

let strips: Partial<Record<string, Strip>> = {}

export function register(paneId: string, strip: Strip): () => void {
  strips[paneId] = strip
  return () => {
    if (strips[paneId] === strip) strips = without(strips, paneId)
  }
}

export const keyOf = (where: Landing | null): string =>
  !where
    ? ''
    : where.kind === 'strip'
      ? `strip:${where.paneId}:${where.at}`
      : `pane:${where.paneId}:${where.zone}`

export function stripOf(paneId: string): Strip | undefined {
  return strips[paneId]
}

let arriving: { tabId: string; left: number; top: number } | null = null

export function handOver(tabId: string, left: number, top: number) {
  arriving = { tabId, left, top }
}

export function arrival(tabId: string): { left: number; top: number } | null {
  if (arriving?.tabId !== tabId) return null

  const where = arriving
  arriving = null
  return where
}

export const picks: { loaded: typeof import('./picking.svelte') | null } = $state({
  loaded: null,
})
