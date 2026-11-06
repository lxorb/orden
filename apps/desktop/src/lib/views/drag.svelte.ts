import type { Row, Value } from '@orden/bases'

export interface Point {
  x: number
  y: number
}

type Take = (row: Row, at: Point, place: HTMLElement, from: Value | undefined) => void

const SLOP = 4
export const HOLD = 350
export const THUMB_SLOP = SLOP * 2

let thumbCarrying = false

export function carryThumb(on: boolean): void {
  thumbCarrying = on
}

function keepThumb(event: TouchEvent) {
  if (thumbCarrying && event.cancelable) event.preventDefault()
}

export function isThumbCarrying(): boolean {
  return thumbCarrying
}

const listening = new WeakMap<HTMLElement, number>()

export function holdsThumb(node: HTMLElement) {
  const list = node.parentElement ?? node
  const rows = listening.get(list) ?? 0
  if (rows === 0) list.addEventListener('touchmove', keepThumb, { passive: false })
  listening.set(list, rows + 1)
  node.style.setProperty('-webkit-touch-callout', 'none')
  return {
    destroy() {
      const left = (listening.get(list) ?? 1) - 1
      listening.set(list, left)
      if (left === 0) list.removeEventListener('touchmove', keepThumb)
    },
  }
}

class Dragging {
  row = $state.raw<Row | null>(null)
  label = $state('')
  x = $state(0)
  y = $state(0)
  over = $state.raw<HTMLElement | null>(null)
}

export const dragging = new Dragging()

const ghosts: symbol[] = []
let drawing = $state<symbol | null>(null)

export function ghostOwner(): { mine: () => boolean; release: () => void } {
  const me = Symbol('ghost')
  ghosts.push(me)
  drawing = ghosts[0] ?? null
  return {
    mine: () => drawing === me,
    release: () => {
      ghosts.splice(ghosts.indexOf(me), 1)
      drawing = ghosts[0] ?? null
    },
  }
}

const takers = new WeakMap<HTMLElement, Take>()

export function droppable(node: HTMLElement, take: Take) {
  takers.set(node, take)
  node.dataset.drop = ''
  return {
    update(next: Take) {
      takers.set(node, next)
    },
    destroy() {
      takers.delete(node)
    },
  }
}

function targetAt(at: Point): HTMLElement | null {
  const found = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-drop]')
  return found ?? null
}

function scrollerAt(at: Point): HTMLElement | null {
  for (let box = document.elementFromPoint(at.x, at.y); box; box = box.parentElement) {
    if (!(box instanceof HTMLElement)) continue
    const style = getComputedStyle(box)
    if (
      /(auto|scroll)/.test(style.overflowY + style.overflowX) &&
      box.scrollHeight + box.scrollWidth > box.clientHeight + box.clientWidth
    ) {
      return box
    }
  }
  return null
}

function nudge(at: Point) {
  const box = scrollerAt(at)
  if (!box) return
  const rect = box.getBoundingClientRect()
  const edge = 36
  const step = (distance: number) => Math.round(((edge - distance) / edge) * 14)
  if (at.y < rect.top + edge) box.scrollTop -= step(at.y - rect.top)
  else if (at.y > rect.bottom - edge) box.scrollTop += step(rect.bottom - at.y)
  if (at.x < rect.left + edge) box.scrollLeft -= step(at.x - rect.left)
  else if (at.x > rect.right - edge) box.scrollLeft += step(rect.right - at.x)
}

export interface Carry {
  row: Row
  label: string
  disabled?: boolean
  from?: Value | undefined
}

export function draggable(node: HTMLElement, start: Carry) {
  let carry = start
  let from: Point | null = null
  let held: ReturnType<typeof setTimeout> | undefined
  let lifted = false
  let frame = 0
  let went = false
  const thumb = holdsThumb(node)
  let thumbed = false

  const lift = () => {
    lifted = true
    dragging.row = carry.row
    dragging.label = carry.label
    node.classList.add('is-carried')
  }

  const move = (event: PointerEvent) => {
    const at = { x: event.clientX, y: event.clientY }
    if (!lifted) {
      if (!from) return
      const far = Math.hypot(at.x - from.x, at.y - from.y)
      if (event.pointerType === 'touch') {
        if (far > THUMB_SLOP) cancel()
        return
      }
      if (far < SLOP) return
      lift()
    }
    event.preventDefault()
    if (!from || !thumbed || Math.hypot(at.x - from.x, at.y - from.y) > THUMB_SLOP) went = true
    dragging.x = at.x
    dragging.y = at.y
    const target = targetAt(at)
    if (target !== dragging.over) {
      dragging.over?.classList.remove('is-taking')
      target?.classList.add('is-taking')
      dragging.over = target
    }
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => nudge(at))
  }

  const finish = (event: PointerEvent | null) => {
    clearTimeout(held)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    cancelAnimationFrame(frame)
    const was = lifted
    const target = dragging.over
    const row = dragging.row
    lifted = false
    went = false
    if (thumbed) carryThumb(false)
    thumbed = false
    from = null
    node.classList.remove('is-carried')
    target?.classList.remove('is-taking')
    dragging.row = null
    dragging.over = null
    if (!was) return
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    if (event && target && row)
      takers.get(target)?.(row, { x: event.clientX, y: event.clientY }, target, carry.from)
  }

  const up = (event: PointerEvent) => finish(event)
  const cancel = () => finish(null)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  const down = (event: PointerEvent) => {
    if (carry.disabled || event.button !== 0) return
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable]')
    )
      return
    from = { x: event.clientX, y: event.clientY }
    dragging.x = from.x
    dragging.y = from.y
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    if (event.pointerType === 'touch') {
      held = setTimeout(() => {
        carryThumb(true)
        thumbed = true
        lift()
      }, HOLD)
    }
  }

  const menu = (event: Event) => {
    if (!lifted) return
    if (went) {
      event.preventDefault()
      event.stopImmediatePropagation()
    } else cancel()
  }

  node.addEventListener('pointerdown', down)
  node.addEventListener('contextmenu', menu, true)
  return {
    update(next: Carry) {
      carry = next
    },
    destroy() {
      thumb.destroy()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('contextmenu', menu, true)
      if (from) cancel()
    },
  }
}

function swallow(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export function placeAmong(items: readonly Element[], at: Point, across = false): number {
  for (let index = 0; index < items.length; index++) {
    const box = items[index]?.getBoundingClientRect()
    if (!box) continue
    const middle = across ? box.left + box.width / 2 : box.top + box.height / 2
    if ((across ? at.x : at.y) < middle) return index
  }
  return items.length
}
