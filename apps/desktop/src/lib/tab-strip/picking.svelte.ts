import { workspace, type Tab } from '../workspace.svelte'
import type { Landing } from '../workspace/panes.svelte'
import { type Bounds, endOf, moved, placed, widthsFor } from './layout'
import { duplicateTab, moveToOtherPane } from './ops'

export type Picking = 'toggle' | 'run' | 'add-run'

export function pickingOf(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  mac: boolean,
): Picking | null {
  const toggle = mac ? event.metaKey : event.ctrlKey
  if (toggle && event.shiftKey) return 'add-run'
  if (event.shiftKey) return 'run'
  return toggle ? 'toggle' : null
}

class Chosen {
  paneId = $state<string | null>(null)
  ids = $state<readonly string[]>([])
  anchor: string | null = null

  of(paneId: string): Tab[] {
    if (this.paneId !== paneId || this.ids.length < 2) return []

    const front = workspace.panes.at(paneId)?.activeTabId
    if (!front || !this.ids.includes(front)) return []

    const tabs = workspace.tabsIn(paneId).filter((one) => this.ids.includes(one.id))
    return tabs.length > 1 ? tabs : []
  }

  clear() {
    this.paneId = null
    this.ids = []
    this.anchor = null
  }
}

export const chosen = new Chosen()

export function runOf(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return order.includes(to) ? [to] : []

  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

export function pick(paneId: string, id: string, how: Picking): string | null {
  const order = workspace.tabsIn(paneId).map((one) => one.id)
  const front = workspace.panes.at(paneId)?.activeTabId ?? id
  const had = chosen.of(paneId).map((one) => one.id)
  const now = had.length ? had : [front]
  const anchor = chosen.anchor !== null && now.includes(chosen.anchor) ? chosen.anchor : front

  let ids: string[]
  if (how === 'toggle') {
    ids = now.includes(id) ? now.filter((one) => one !== id) : [...now, id]
    chosen.anchor = id
  } else {
    const run = runOf(order, anchor, id)
    ids = how === 'run' ? run : [...now, ...run.filter((one) => !now.includes(one))]
    chosen.anchor = anchor
  }

  chosen.paneId = paneId
  chosen.ids = ids
  if (ids.includes(id)) return id
  if (ids.includes(front)) return front
  return ids.at(-1) ?? null
}

export function gathered<T extends { readonly id: string }>(
  order: readonly T[],
  widths: readonly number[],
  block: readonly string[],
  lead: string,
): { order: T[]; widths: number[]; from: number; before: number } {
  const kept: T[] = []
  const keptWidths: number[] = []
  let before = 0
  let wide = 0
  let passed = false

  for (const [at, one] of order.entries()) {
    const width = widths[at] ?? 0
    if (block.includes(one.id)) {
      wide += width
      if (one.id === lead) passed = true
      else if (!passed) before += width
      if (one.id !== lead) continue
    }
    kept.push(one)
    keptWidths.push(width)
  }

  const from = kept.findIndex((one) => one.id === lead)
  if (from >= 0) keptWidths[from] = wide
  return { order: kept, widths: keptWidths, from, before }
}

interface Laid {
  readonly id: string
  readonly icon: boolean
  readonly active: boolean
}

interface Held {
  readonly x: number
  readonly from: number
  readonly slot: number
  readonly out: boolean
}

export class Block {
  readonly strip: { order: Laid[]; widths: number[]; from: number; before: number }

  private constructor(
    readonly lead: string,
    readonly ids: readonly string[],
    private readonly sized: readonly Laid[],
    private readonly widths: readonly number[],
  ) {
    this.strip = gathered(sized, widths, ids, lead)
  }

  static of(paneId: string, tab: Tab, sized: readonly Laid[], widths: readonly number[]) {
    const picked = chosen.of(paneId)
    const ids = picked.map((one) => one.id)
    return picked.includes(tab) && ids.length > 1 ? new Block(tab.id, ids, sized, widths) : null
  }

  frame(room: number): { widths: number[]; room: number } {
    return { widths: this.strip.widths, room }
  }

  layout(room: number | null, held: Held): { boxes: Record<string, Bounds>; end: number } {
    const boxes: Record<string, Bounds> = {}
    let bounds: Bounds[]

    if (held.out) {
      const rest = this.sized.filter((one) => !this.ids.includes(one.id))
      bounds = placed(widthsFor(rest, room))
      for (const [at, one] of rest.entries()) boxes[one.id] = bounds[at] ?? { x: 0, width: 0 }
    } else {
      const order = moved(this.strip.order, held.from, held.slot)
      bounds = placed(moved(this.strip.widths, held.from, held.slot))
      for (const [at, one] of order.entries()) {
        if (one.id !== this.lead) boxes[one.id] = bounds[at] ?? { x: 0, width: 0 }
      }
    }

    let x = held.x
    for (const id of this.ids) {
      const width = this.widths[this.sized.findIndex((one) => one.id === id)] ?? 0
      boxes[id] = { x, width }
      x += width
    }
    return { boxes, end: endOf(bounds) }
  }

  order(held: Held): string[] {
    return moved(this.strip.order, held.from, held.slot).flatMap((one) =>
      one.id === this.lead ? [...this.ids] : [one.id],
    )
  }

  moved(paneId: string, from: number, to: number) {
    this.land(paneId, moved(this.strip.order, from, to)[to + 1]?.id ?? null)
  }

  dropped(where: Landing) {
    const before =
      where.kind === 'strip' ? (workspace.tabsIn(where.paneId)[where.at]?.id ?? null) : null
    workspace.dropTab(this.lead, where)
    const into = workspace.tabs.find((one) => one.id === this.lead)?.paneId
    if (into) this.land(into, before)
  }

  private land(paneId: string, before: string | null) {
    placeBlock(this.ids, paneId, before)
    workspace.activate(this.lead)
    chosen.paneId = paneId
  }
}

export function placeBlock(ids: readonly string[], paneId: string, before: string | null) {
  let next = before
  for (const id of [...ids].reverse()) {
    const strip = workspace.tabsIn(paneId).filter((one) => one.id !== id)
    const at = next === null ? -1 : strip.findIndex((one) => one.id === next)
    workspace.moveTab(id, paneId, at < 0 ? strip.length : at)
    next = id
  }
}

export function moveManyToOtherPane(ids: readonly string[]) {
  const [first] = ids
  if (first === undefined) return

  moveToOtherPane(first)
  const paneId = workspace.tabs.find((one) => one.id === first)?.paneId
  if (!paneId) return

  placeBlock(ids, paneId, null)
  chosen.paneId = paneId
}

export function duplicateMany(ids: readonly string[]) {
  for (const id of ids) duplicateTab(id)
}

export async function closeChosen(tabs: readonly Tab[]) {
  await workspace.closeMany(tabs.map((one) => one.id))
}
