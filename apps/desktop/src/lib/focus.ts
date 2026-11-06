import { isRegion, type Region, REGIONS, stepRegion } from './regions'
import type { Panel } from './workspace.svelte'
import { workspace } from './workspace.svelte'

const FOCUSABLE =
  '[tabindex="0"], button, input, select, textarea, a[href], summary, [contenteditable="true"]'

function reachable(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.matches(':disabled') || node.getAttribute('aria-hidden') === 'true') return false
  if (node.closest('[inert]')) return false
  if (node.tabIndex < 0) return false

  return node.getClientRects().length > 0
}

function standing(box: HTMLElement): boolean {
  if (box.getClientRects().length === 0 || box.closest('[inert]')) return false
  if (box.childElementCount === 0) return false
  return getComputedStyle(box).visibility !== 'hidden'
}

function boxOf(name: Region): HTMLElement | null {
  for (const found of document.querySelectorAll<HTMLElement>(`[data-region="${name}"]`)) {
    if (!standing(found)) continue
    if (found.dataset.panel !== undefined && found.dataset.panel !== workspace.panel) continue

    return found
  }

  return null
}

function regionsOn(): Region[] {
  return REGIONS.filter((name) => boxOf(name) !== null)
}

function regionHere(): Region | null {
  const at = document.activeElement
  const box = at instanceof Element ? at.closest('[data-region]') : null
  const name = box?.getAttribute('data-region')

  return isRegion(name) ? name : null
}

function within(name: Region, panel?: Panel): HTMLElement | null {
  const region = boxOf(name)
  return (panel ? region?.querySelector<HTMLElement>(`[data-panel="${panel}"]`) : null) ?? region
}

function entryOf(name: Region, panel?: Panel): HTMLElement | null {
  const box = within(name, panel)
  if (!box) return null

  const writing = box.querySelector('.cm-content, [data-entry]')
  if (writing instanceof HTMLElement) return writing

  for (const one of box.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (reachable(one) && one.getAttribute('role') !== 'separator') return one
  }

  if (box.tabIndex < 0 && !box.hasAttribute('tabindex')) box.tabIndex = -1
  return box
}

function focusRegion(name: Region, panel?: Panel): boolean {
  const entry = entryOf(name, panel)
  if (!entry) return false

  entry.focus()
  return document.activeElement === entry
}

export function focusEditor(): boolean {
  return focusRegion('editor')
}

export function focusList(): boolean {
  return focusRegion('list')
}

export function intoSide(side: 'left' | 'right'): HTMLElement | null {
  if (!focusRegion(side === 'right' ? 'right' : 'space')) return null
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

export function stepRegionFocus(direction: number): boolean {
  const present = regionsOn()
  let from: string | null = regionHere()
  let left = present.length

  while (left-- > 0) {
    const next = stepRegion(present, from, direction)
    if (!next) return false
    if (focusRegion(next)) return true
    from = next
  }

  return false
}

export function revealPanel(panel: Panel): void {
  if (!workspace.offers(panel)) return
  const side = workspace.sideOf(panel)
  const region: Region = side === 'right' ? 'right' : 'list'
  if (workspace.openOn(side) === panel && regionHere() === region) {
    focusEditor()
    return
  }

  workspace.showPanel(panel)
  settle(region, panel)
}

function settle(name: Region, panel?: Panel, left = 8): void {
  requestAnimationFrame(() => {
    const at = document.activeElement
    if (at instanceof HTMLElement && at.isConnected && within(name, panel)?.contains(at)) return

    focusRegion(name, panel)
    if (left > 0) settle(name, panel, left - 1)
  })
}

function pressRegion(name: Region, what?: string): boolean {
  const found = what === undefined ? null : boxOf(name)?.querySelector(what)
  const entry = found instanceof HTMLElement ? found : entryOf(name)
  if (!entry) return false

  press(entry)
  return true
}

function press(entry: HTMLElement): void {
  entry.focus()
  const box = entry.getBoundingClientRect()
  entry.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(box.left + 8),
      clientY: Math.round(box.bottom),
    }),
  )
}

const SWITCHER = '[aria-haspopup="menu"]'

export function openSpaces(): void {
  if (pressRegion('space', SWITCHER)) return

  workspace.showPanel('tree')
  requestAnimationFrame(() => {
    pressRegion('space', SWITCHER)
  })
}

export function keepFocus(event: Pick<Event, 'preventDefault'> & { pointerType?: string }): void {
  if (event.pointerType !== 'touch') event.preventDefault()
}
