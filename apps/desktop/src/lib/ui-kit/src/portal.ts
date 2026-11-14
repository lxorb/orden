import type { SettingsPartHost, SettingsPartView } from '@orden/contracts'
import { type Component, mount, unmount } from 'svelte'

export function portal(node: HTMLElement) {
  document.body.append(node)
  return { destroy: () => node.remove() }
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Hanging {
  side?: 'below' | 'above'
  gap?: number
  inset?: number | `--${string}`
  stretch?: boolean
  from?: HTMLElement | null
}

const MARGIN = 8

export function placeOf(
  at: Box,
  size: { width: number; height: number },
  room: { width: number; height: number },
  hanging: { side: 'below' | 'above'; gap: number; inset: number },
  rtl: boolean,
): { left: number; top: number; side: 'below' | 'above' } {
  const { gap, inset } = hanging
  const width = size.width
  const start = rtl ? at.right - inset - width : at.left + inset
  const left = Math.max(MARGIN, Math.min(start, room.width - MARGIN - width))

  const below = at.bottom + gap
  const above = at.top - gap - size.height
  const fitsBelow = below + size.height <= room.height - MARGIN
  const fitsAbove = above >= MARGIN
  const side =
    hanging.side === 'below'
      ? fitsBelow || !fitsAbove
        ? 'below'
        : 'above'
      : fitsAbove || !fitsBelow
        ? 'above'
        : 'below'
  return { left, top: side === 'below' ? below : above, side }
}

export function inSight(at: Box, clips: readonly Box[]): boolean {
  let { left, top, right, bottom } = at
  for (const one of clips) {
    left = Math.max(left, one.left)
    top = Math.max(top, one.top)
    right = Math.min(right, one.right)
    bottom = Math.min(bottom, one.bottom)
  }
  return right >= left && bottom >= top
}

function clipsOf(node: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
    const style = getComputedStyle(up)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') found.push(up)
  }
  return found
}

function boxOf(node: Element): Box {
  const box = node.getBoundingClientRect()
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
}

function drawn(node: Element): boolean {
  if (typeof node.checkVisibility !== 'function') return true
  return node.checkVisibility({ visibilityProperty: true })
}

function moving(): boolean {
  if (typeof document.getAnimations !== 'function') return false
  return document
    .getAnimations()
    .some(
      (one) => one.playState === 'running' && one.effect?.getComputedTiming().endTime !== Infinity,
    )
}

function holderOf(node: HTMLElement): HTMLElement | null {
  for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
    if (getComputedStyle(up).position !== 'static') return up
  }
  return node.parentElement
}

export function hang(node: HTMLElement, hanging: Hanging = {}) {
  let options = hanging
  const from = options.from ?? holderOf(node)
  if (!from) return {}

  const clips = clipsOf(from)

  document.body.append(node)
  node.style.position = 'fixed'
  node.style.inset = 'auto'
  node.style.margin = '0'

  let frame = 0
  const place = () => {
    frame = 0
    if (!from.isConnected) return
    const at = boxOf(from)
    const seen = drawn(from) && inSight(at, clips.map(boxOf))
    const visibility = seen ? '' : 'hidden'
    if (node.style.visibility !== visibility) node.style.visibility = visibility
    const width = `${at.right - at.left}px`
    if (options.stretch && node.style.width !== width) node.style.width = width
    const style = getComputedStyle(from)
    const inset =
      typeof options.inset === 'string'
        ? parseFloat(style.getPropertyValue(options.inset)) || 0
        : (options.inset ?? 0)
    const spot = placeOf(
      at,
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { side: options.side ?? 'below', gap: options.gap ?? 4, inset },
      style.direction === 'rtl',
    )
    const left = `${spot.left}px`
    const top = `${spot.top}px`
    if (node.style.left !== left) node.style.left = left
    if (node.style.top !== top) node.style.top = top
    if (node.dataset.side !== spot.side) node.dataset.side = spot.side
    if (moving()) soon()
  }
  const soon = () => {
    frame ||= requestAnimationFrame(place)
  }

  place()
  const moved = ['scroll', 'resize', 'transitionrun', 'animationstart'] as const
  for (const one of moved) window.addEventListener(one, soon, { capture: true, passive: true })
  const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null
  sized?.observe(node)
  for (let up: HTMLElement | null = from; up && up !== document.body; up = up.parentElement)
    sized?.observe(up)

  return {
    update(next: Hanging = {}) {
      options = next
      soon()
    },
    destroy() {
      cancelAnimationFrame(frame)
      for (const one of moved) window.removeEventListener(one, soon, { capture: true })
      sized?.disconnect()
      node.remove()
    },
  }
}

export function partView<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: (host: SettingsPartHost) => Props,
): SettingsPartView {
  return {
    show: (target, host) => {
      if (!(target instanceof HTMLElement)) return () => undefined
      const shown = mount(component, { target, props: props(host) })
      return () => void unmount(shown)
    },
  }
}
