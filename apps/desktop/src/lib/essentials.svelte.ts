import { carriedRows, draggedBookmark, isBookmarkDrag, isTreeDrag } from './drag-paths'
import { chorded } from './keys'
import { reading } from './direction'
import type { OpenHow } from './new-tab'
import { moving } from './list-landing.svelte'
import { canWriteAt } from './sharing.svelte'
import { folderOf, insideSpace, samePath } from './space-paths'
import {
  type Bookmark,
  filedUnder,
  MOST_BOOKMARKS,
  sameBookmark,
} from './workspace/bookmarks.svelte'
import { workspace, type Entry } from './workspace.svelte'

class Landing {
  at = $state<number | null>(null)
  after = $state(false)

  over(at: number, after: boolean) {
    if (this.at === at && this.after === after) return
    this.at = at
    this.after = after
  }

  near(zone: HTMLElement, x: number, y: number): boolean {
    const spot = landingNear(zone, x, y)
    if (spot) this.over(spot.at, spot.after)
    return spot !== null
  }

  clear() {
    this.at = null
  }
}

export const landing = new Landing()

export function takes(event: DragEvent): boolean {
  const transfer = event.dataTransfer
  if (!isBookmarkDrag(transfer) && !isTreeDrag(transfer)) return false

  event.preventDefault()
  if (transfer) transfer.dropEffect = isBookmarkDrag(transfer) ? 'move' : 'copy'
  return true
}

export function overGrid(event: DragEvent) {
  if (!takes(event)) return
  if (!landing.near(event.currentTarget as HTMLElement, event.clientX, event.clientY)) {
    landing.over(workspace.bookmarks.list.length, false)
  }
}

export function leaving(event: DragEvent) {
  const into = event.relatedTarget
  if (!(into instanceof Node) || !(event.currentTarget as HTMLElement).contains(into)) {
    landing.clear()
  }
}

export function keepCarried(
  event: DragEvent,
  at: number,
  entry: (path: string) => Entry | undefined,
) {
  if (!isTreeDrag(event.dataTransfer)) return false

  keepRows(carriedRows(event.dataTransfer), at, entry)
  return true
}

export function keepRows(
  rows: readonly string[],
  at: number,
  entry: (path: string) => Entry | undefined,
) {
  const marks = rows
    .map(entry)
    .filter((one): one is Entry => one !== undefined)
    .map((one) => workspace.bookmarks.forEntry(one))
    .filter((mark): mark is Bookmark => mark !== null)
  place(marks, at)
}

export function dropOnGrid(event: DragEvent, entry: (path: string) => Entry | undefined) {
  event.preventDefault()

  const { at, after } = landing
  landing.clear()
  if (at === null || keepCarried(event, after ? at + 1 : at, entry)) return

  const from = draggedBookmark(event.dataTransfer)
  const moving = from === null ? undefined : workspace.bookmarks.list[from]
  if (from === null || !moving) return

  workspace.bookmarks.moveInto(moving, null)
  workspace.bookmarks.move(from, slotFor(from, at, after))
}

export function placed(held: readonly Bookmark[], marks: readonly Bookmark[], at: number) {
  const coming = (one: Bookmark) => marks.some((mark) => sameBookmark(one, mark))
  const rest = held.filter((one) => !coming(one))
  const into = Math.max(0, Math.min(at, held.length))
  const ahead = into - held.slice(0, into).filter(coming).length

  const come = marks
    .filter((mark, index) => marks.findIndex((other) => sameBookmark(mark, other)) === index)
    .map((mark) => filedUnder(mark, null))
    .slice(0, MOST_BOOKMARKS - rest.length)

  return [...rest.slice(0, ahead), ...come, ...rest.slice(ahead)]
}

export function place(marks: readonly Bookmark[], at: number) {
  const root = workspace.activeSpace?.root
  if (!marks.length || root === undefined) return

  keepAs(root, placed(workspace.bookmarks.of(root), marks, at))
}

function keepAs(root: string, after: Bookmark[]) {
  const before = [...workspace.bookmarks.of(root)]
  moving(() => workspace.bookmarks.put(root, after))
  workspace.undone.record({ kind: 'keep', root, before, after })
}

export async function unkeepInto(at: number, folder: string) {
  const root = workspace.activeSpace?.root
  const held = root === undefined ? [] : workspace.bookmarks.of(root)
  const mark = held[at]
  if (root === undefined || mark?.kind !== 'note') return

  const path = insideSpace(root, mark.path)
  const moves = !samePath(folderOf(path), folder)
  if (moves && !(canWriteAt(path) && canWriteAt(folder))) return
  if (moves && workspace.refusedAsInstructions([path], folder)) return
  await workspace.undone.batch(async () => {
    keepAs(
      root,
      held.filter((_, index) => index !== at),
    )
    if (moves) await workspace.move(path, folder)
  })
  if (!samePath(folder, root)) workspace.device.expand(folder)
}

export function along(key: string, tile: HTMLElement): boolean {
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false

  const all = [...(tile.parentElement?.parentElement?.querySelectorAll<HTMLElement>('.tile') ?? [])]
  const next = all[all.indexOf(tile) + (key === 'ArrowRight' ? 1 : -1)]
  next?.focus()
  return next !== undefined
}

export function gridKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (chorded(event) || event.shiftKey) return

  const grid = event.currentTarget as HTMLElement
  const all = [...grid.querySelectorAll<HTMLElement>('.tile')]
  const at = all.findIndex((one) => one === event.target)
  if (at < 0) return

  event.preventDefault()
  event.stopPropagation()

  const down = event.key === 'ArrowDown'
  const next = stepInGrid(at, all.length, columnsOf(all.map((one) => one.offsetTop)), down)
  if (next !== null) all[next]?.focus()
  else if (down) grid.parentElement?.querySelector<HTMLElement>('.row')?.focus()
}

export function slotFor(from: number | null, target: number, after: boolean): number {
  const at = from !== null && target > from ? target - 1 : target
  return at + (after ? 1 : 0)
}

export function pastMiddle(x: number, left: number, right: number, rtl: boolean): boolean {
  const middle = (left + right) / 2
  return rtl ? x < middle : x > middle
}

export function stepInGrid(
  at: number,
  count: number,
  columns: number,
  down: boolean,
): number | null {
  const next = at + (down ? columns : -columns)
  if (next >= 0 && next < count) return next

  const row = Math.floor(at / columns)
  return down && row < Math.floor((count - 1) / columns) ? count - 1 : null
}

export function columnsOf(tops: readonly number[]): number {
  const [first] = tops
  return first === undefined ? 1 : Math.max(1, tops.filter((top) => top === first).length)
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

export function nearestTile(boxes: readonly Box[], x: number, y: number): number {
  let best = -1
  let nearest = { down: Infinity, across: Infinity }

  for (const [at, box] of boxes.entries()) {
    const down = Math.max(box.top - y, 0, y - box.bottom)
    const across = Math.max(box.left - x, 0, x - box.right)
    if (down < nearest.down || (down === nearest.down && across < nearest.across)) {
      nearest = { down, across }
      best = at
    }
  }

  return best
}

function landingNear(
  zone: HTMLElement,
  x: number,
  y: number,
): { at: number; after: boolean } | null {
  const all = [...zone.querySelectorAll<HTMLElement>('[data-at]')]
  const boxes = all.map((one) => one.getBoundingClientRect())
  const at = nearestTile(boxes, x, y)
  const near = all[at]
  const box = boxes[at]
  if (!near || !box) return null

  const after = near.classList.contains('tile')
    ? pastMiddle(x, box.left, box.right, reading() === 'rtl')
    : pastMiddle(y, box.top, box.bottom, false)
  return { at: Number(near.dataset.at), after }
}

interface Held {
  essential: string | null
  paneId: string
}

export function essentialTab<T extends Held>(
  tabs: readonly T[],
  path: string,
  shown: (paneId: string) => boolean,
): T | undefined {
  const all = tabs.filter((one) => one.essential !== null && samePath(one.essential, path))
  return all.find((one) => shown(one.paneId)) ?? all[0]
}

export function released<T extends Held>(tabs: readonly T[], kept: readonly string[]): T[] {
  return tabs.filter(
    (one) => one.essential !== null && !kept.some((path) => samePath(path, one.essential)),
  )
}

export function openEssential(path: string): Promise<void> {
  opening = split() ? keepAsTab(path).then(() => undefined) : showEssential(path)
  return opening
}

function split(): boolean {
  return workspace.panes.count > 1 && workspace.panes.fills === null
}

let opening: Promise<void> = Promise.resolve()

async function showEssential(path: string) {
  const ws = workspace
  const held = essentialTab(ws.tabs, path, (paneId) => ws.panes.at(paneId) !== null)
  if (held) {
    ws.front(held.id)
    return
  }

  const open = ws.opened.at(path)
  const web = open?.kind === 'web' ? ws.tabs.find((one) => one.note === open) : undefined
  if (web) {
    web.essential = path
    ws.front(web.id)
    return
  }
  if (open) {
    ws.secondView(open, {}, path)
    return
  }

  ws.essentialComing = path
  try {
    await ws.openEntry(path, { activate: true })
  } finally {
    ws.essentialComing = null
  }
}

export async function keepAsTab(path: string): Promise<string | null> {
  await opening.catch(() => undefined)
  const ws = workspace
  const held = essentialTab(ws.tabs, path, (paneId) => ws.panes.at(paneId) !== null)
  if (!held) {
    await openInStrip(path, {})
    return ws.activeTabId
  }
  held.essential = null
  ws.front(held.id)
  return held.id
}

export async function openInStrip(path: string, how: OpenHow) {
  const ws = workspace
  const open = ws.opened.at(path)
  const inStrip = ws.tabs.some(
    (one) => one.essential === null && one.note === open && ws.panes.at(one.paneId),
  )
  if (open && !inStrip) ws.secondView(open, how)
  else await ws.openEntry(path, how)
}

export function kept() {
  const root = workspace.activeSpace?.root
  if (root === undefined) return

  const files = workspace.bookmarks
    .of(root)
    .filter((one) => one.kind === 'note')
    .map((one) => insideSpace(root, one.path))
  const shown = workspace.tabs.filter((one) => workspace.panes.at(one.paneId) !== null)
  for (const one of released(shown, files)) one.essential = null
}
