import { tick } from 'svelte'
import { dropTarget, targetFor } from './drop-target.svelte'
import { dur, folderOf, nameOf } from './platform/src/api'
import { droppedOnSpace, leftSpaces, overSpaces } from './tab-strip/space-drop'
import { placedBeside, stepped, trimmed } from './tree-arranging'
import { shownNames } from './tree-order'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'

export type Band = 'before' | 'on' | 'after'

const EDGE = 0.25

const SLIDING = 180

const HOLD_TO_LIFT = 250

const LIFT_SLOP = 8

const DWELL = 400

export interface Held {
  rows: () => Iterable<HTMLElement>
  entryFor: (path: string) => Entry | null
  carrying: () => readonly string[]
  carry: (paths: readonly string[]) => void
  edge: (at: number | null) => void
  box: () => HTMLElement | null
  takes: (entry: Entry) => boolean
}

export function bandOf(y: number, top: number, height: number): Band {
  if (height <= 0) return 'on'

  const along = (y - top) / height
  if (along < EDGE) return 'before'
  if (along > 1 - EDGE) return 'after'

  return 'on'
}

export function slides(
  was: ReadonlyMap<string, number>,
  now: ReadonlyMap<string, number>,
  carried: readonly string[] = [],
): Map<string, number> {
  const out = new Map<string, number>()

  for (const [path, here] of now) {
    if (carried.includes(path)) continue

    const before = was.get(path)
    if (before === undefined || before === here) continue

    out.set(path, before - here)
  }

  return out
}

export function placesOf(held: Held): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of held.rows()) {
    const path = row.dataset.path
    if (path !== undefined) out.set(path, row.getBoundingClientRect().top)
  }

  return out
}

export async function slideInto(held: Held, was: Map<string, number>): Promise<void> {
  if (dur(SLIDING) === 0) return

  await tick()
  const moving = slides(was, placesOf(held), held.carrying())

  for (const row of held.rows()) {
    const from = moving.get(row.dataset.path ?? '')
    if (from === undefined) continue

    row.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
      duration: dur(SLIDING),
      easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
    })
  }
}

export async function arrive(held: Held, was: Map<string, number>): Promise<void> {
  if (dur(SLIDING) === 0) return

  await slideInto(held, was)
  for (const row of held.rows()) {
    if (was.has(row.dataset.path ?? '')) continue
    row.animate(
      [
        { opacity: 0, transform: 'translateX(-6px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: dur(SLIDING),
        easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      },
    )
  }
}

function childrenIn(folder: string): readonly Entry[] {
  const tree = workspace.shownTree
  if (!tree) return []
  if (tree.path === folder) return tree.children

  return entryAt(tree, folder)?.children ?? []
}

function canArrange(moving: readonly string[], target: string): boolean {
  if (workspace.sortMode !== 'manual') return false
  if (!moving.length || moving.includes(target)) return false

  const folder = folderOf(target)
  return moving.every((path) => folderOf(path) === folder)
}

export function showArrange(moving: readonly string[], target: string, after: boolean): boolean {
  if (!canArrange(moving, target)) return false

  const folder = folderOf(target)
  const children = childrenIn(folder)
  const names = placedBeside(
    children,
    workspace.arranged.savedList(folder),
    moving.map((path) => nameOf(path)),
    nameOf(target),
    after,
  )

  workspace.arranged.show(folder, names)
  return true
}

export function holdArrange(moving: readonly string[], target: string): boolean {
  return workspace.sortMode === 'manual' && workspace.arranged.dragging && moving.includes(target)
}

export function moveInOrder(path: string, by: number): boolean {
  if (workspace.sortMode !== 'manual') return false

  const entry = workspace.entryAt(path)
  if (!entry) return false

  const folder = folderOf(path)
  const children = childrenIn(folder)
  const displayed = shownNames(children, 'manual', workspace.arranged.savedList(folder))

  const moved = stepped(displayed, entry.name, by)
  if (!moved) return false

  workspace.arranged.set(folder, trimmed(children, moved))

  return true
}

let ghost: HTMLElement | null = null
let ghostFrom = 0

let holding: ReturnType<typeof setTimeout> | null = null
let heldAt = { x: 0, y: 0 }

let dwelling: ReturnType<typeof setTimeout> | null = null
let dwellOn: string | null = null

export function aimAt(held: Held, row: HTMLElement, y: number, entry: Entry): boolean {
  const carrying = held.carrying()
  if (workspace.sortMode !== 'manual' || !carrying.length) return false
  if (holdArrange(carrying, entry.path)) return true

  const box = row.getBoundingClientRect()
  const band: Band = bandOf(y, box.top, box.height)
  if (band === 'on') return false

  const was = placesOf(held)
  if (!showArrange(carrying, entry.path, band === 'after')) return false

  void slideInto(held, was)
  return true
}

export function dwellOver(path: string | null, folder: boolean): void {
  if (path === dwellOn) return

  dwellOn = path
  if (dwelling !== null) clearTimeout(dwelling)
  dwelling = null
  if (path === null || !folder || workspace.isExpanded(path)) return

  dwelling = setTimeout(() => {
    dwelling = null
    if (dwellOn === path) workspace.device.expand(path)
  }, DWELL)
}

export function slideBack(held: Held): void {
  if (!workspace.arranged.dragging) return

  const was = placesOf(held)
  workspace.arranged.unshow()
  void slideInto(held, was)
}

export function letGo(held: Held): void {
  slideBack(held)
  dwellOver(null, false)
  held.carry([])
}

function lift(held: Held, row: HTMLElement, entry: Entry) {
  holding = null
  held.carry(workspace.dragPayload(entry.path))

  const box = row.getBoundingClientRect()
  const copy = row.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return

  copy.classList.add('carried')
  copy.dataset.covers = ''
  copy.style.width = `${box.width}px`
  copy.style.left = `${box.left}px`
  copy.style.top = `${box.top}px`
  copy.setAttribute('aria-hidden', 'true')
  document.body.append(copy)

  ghost = copy
  ghostFrom = heldAt.y

  const moved = (event: TouchEvent) => onLiftMove(held, event)
  const ended = (event: TouchEvent) => onLiftEnd(held, event)
  const gone = () => dropLift(held)
  const pressed = (event: KeyboardEvent) => onLiftKey(held, event)
  stopping = () => {
    window.removeEventListener('touchmove', moved)
    window.removeEventListener('touchend', ended)
    window.removeEventListener('touchcancel', gone)
    window.removeEventListener('keydown', pressed)
  }

  window.addEventListener('touchmove', moved, { passive: false })
  window.addEventListener('touchend', ended)
  window.addEventListener('touchcancel', gone)
  window.addEventListener('keydown', pressed)
}

let stopping: (() => void) | null = null

export function touchHeld(
  held: Held,
  at: { x: number; y: number },
  row: HTMLElement,
  entry: Entry,
): void {
  if (ghost) return

  heldAt = at
  holding = setTimeout(() => lift(held, row, entry), HOLD_TO_LIFT)
}

export function touchMoved(event: TouchEvent): void {
  const touch = event.touches[0]
  if (!touch || holding === null) return

  const strayed =
    Math.abs(touch.clientX - heldAt.x) > LIFT_SLOP || Math.abs(touch.clientY - heldAt.y) > LIFT_SLOP
  if (strayed) cancelHold()
}

export function cancelHold(): void {
  if (holding !== null) clearTimeout(holding)
  holding = null
}

function onLiftMove(held: Held, event: TouchEvent) {
  const touch = event.touches[0]
  if (!ghost || !touch) return

  if (event.cancelable) event.preventDefault()

  ghost.style.transform = `translateY(${touch.clientY - ghostFrom}px) scale(1.03)`

  if (overSpaces({ paths: held.carrying() }, { x: touch.clientX, y: touch.clientY })) {
    slideBack(held)
    dropTarget.clear()
    dwellOver(null, false)
    return
  }

  const under = document.elementFromPoint(touch.clientX, touch.clientY)
  const row = under instanceof Element ? under.closest('.row[data-path]') : null
  const path = row instanceof HTMLElement ? row.dataset.path : undefined
  const entry = path === undefined ? null : held.entryFor(path)

  if (row instanceof HTMLElement && entry) {
    if (aimAt(held, row, touch.clientY, entry)) {
      dropTarget.clear()
      dwellOver(null, false)
    } else if (held.takes(entry)) {
      slideBack(held)
      dropTarget.over(targetFor(entry.path, entry.is_dir))
      dwellOver(entry.path, entry.is_dir)
    }
  }

  const box = held.box()
  if (box) held.edge(touch.clientY - box.getBoundingClientRect().top)
}

function onLiftEnd(held: Held, event: TouchEvent) {
  if (event.cancelable) event.preventDefault()

  const landed = workspace.arranged.dragging
  const folder = dropTarget.folder
  const paths = [...held.carrying()]

  if (landed) workspace.arranged.drop()
  if (!landed && droppedOnSpace({ paths })) {
    dropLift(held)
    return
  }
  dropLift(held)

  if (!landed && folder && paths.length) void workspace.moveMany(paths, folder)
}

function onLiftKey(held: Held, event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  event.preventDefault()
  dropLift(held)
}

export function dropLift(held: Held): void {
  ghost?.remove()
  ghost = null
  cancelHold()
  leftSpaces()
  dropTarget.clear()
  letGo(held)
  held.edge(null)

  stopping?.()
  stopping = null
}
