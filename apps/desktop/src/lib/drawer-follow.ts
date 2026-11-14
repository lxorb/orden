import { flushSync } from 'svelte'
import {
  CLAIM,
  claimsGesture,
  fromEdge,
  isFinger,
  opensDrawer,
  ownsGesture,
  SETTLE_MAX,
  SETTLE_MIN,
  settleOpen,
} from './swipe'
import { fullscreen } from './fullscreen.svelte'
import { dur } from './platform/src/api'
import { isThumbCarrying } from './views/drag.svelte'
import { viewport } from './ui-kit/src/api'
import { drawer, rightDrawer } from './drawer.svelte'

type Drawer = typeof drawer

export function followDrawers(host: HTMLElement): () => void {
  let startX = 0
  let startY = 0
  let width = 0
  let candidate = false
  let claimed = false
  let openedByDrag = false
  let ready = false
  let lastX = 0
  let lastAt = 0
  let velocity = 0
  let pointer = 'touch'
  let moving: Drawer | null = null
  let could: Drawer[] = []

  const edge = edgeWidth()

  const single = (event: TouchEvent) => (event.touches.length === 1 ? event.touches[0] : undefined)

  const letGo = () => {
    candidate = false
    moving = null
    could = []
    drawer.held = false
    rightDrawer.held = false
  }

  const onPointerDown = (event: PointerEvent) => {
    pointer = event.pointerType
  }

  const onStart = (event: TouchEvent) => {
    claimed = false
    openedByDrag = false
    ready = false
    width = 0
    letGo()

    const touch = single(event)
    if (!touch || !isFinger(pointer) || isStylus(touch)) return

    if (fullscreen.on) return

    const atEdge = [drawer, rightDrawer].some(
      (one) => one.there && fromEdge(touch.clientX, one.sign) <= edge,
    )
    const under = document.elementFromPoint(touch.clientX, touch.clientY)
    if (ownsGesture(under, host, atEdge)) return

    const anywhere = viewport.device === 'phone'

    const out = rightDrawer.panel ? rightDrawer : drawer.panel ? drawer : null

    if (out) {
      moving = out
      could = [out]
      width = out.measure(host)
      out.width = width
    } else {
      could = [drawer, rightDrawer].filter(
        (one) => one.there && opensDrawer(fromEdge(touch.clientX, one.sign), edge, anywhere),
      )
      if (!could.length) return

      for (const one of could) one.width = one.remembered()
    }

    startX = touch.clientX
    startY = touch.clientY
    lastX = touch.clientX
    lastAt = event.timeStamp
    velocity = 0
    candidate = true
    for (const one of could) one.held = true
  }

  const onMove = (event: TouchEvent) => {
    const touch = single(event)
    if (!candidate || !touch) return

    const along = touch.clientX - startX
    const dy = touch.clientY - startY

    if (!claimed) {
      if (isThumbCarrying()) {
        letGo()
        return
      }

      if (Math.abs(dy) > CLAIM) {
        letGo()
        return
      }
      if (!claimsGesture(along, dy)) return

      moving ??= could.find((one) => one.sign === Math.sign(along)) ?? null
      if (!moving) {
        letGo()
        return
      }

      for (const one of could) if (one !== moving) one.held = false
      could = [moving]

      claimed = true
      width = moving.width

      if (!moving.panel) {
        moving.open()
        openedByDrag = true

        if (!width) {
          flushSync()
          width = moving.measure(host)
          moving.width = width
        }
      }

      ready = true
    }

    if (!ready || !width || !moving) return

    const elapsed = event.timeStamp - lastAt
    if (elapsed > 0) velocity = ((touch.clientX - lastX) / elapsed) * moving.sign
    lastX = touch.clientX
    lastAt = event.timeStamp

    const base = openedByDrag ? 0 : width
    moving.at = Math.max(0, Math.min(width, base + along * moving.sign))
    event.preventDefault()
  }

  const onEnd = () => {
    const one = moving
    drawer.held = false
    rightDrawer.held = false
    if (!claimed || !one) {
      letGo()
      return
    }

    const settled = settleOpen(one.at ?? 0, width, velocity)
    const remaining = Math.abs((one.at ?? 0) - (settled ? width : 0))
    one.settle = dur(
      Math.round(SETTLE_MIN + (SETTLE_MAX - SETTLE_MIN) * (width ? remaining / width : 0)),
    )
    one.at = null
    claimed = false
    candidate = false
    moving = null
    could = []

    if (settled !== !!one.panel) {
      if (settled) one.open()
      else one.close()
    }
  }

  host.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
  host.addEventListener('touchstart', onStart, { passive: true })
  host.addEventListener('touchmove', onMove, { passive: false })
  host.addEventListener('touchend', onEnd)
  host.addEventListener('touchcancel', onEnd)

  return () => {
    host.removeEventListener('pointerdown', onPointerDown, { capture: true })
    host.removeEventListener('touchstart', onStart)
    host.removeEventListener('touchmove', onMove)
    host.removeEventListener('touchend', onEnd)
    host.removeEventListener('touchcancel', onEnd)
  }
}

function edgeWidth(): number {
  const width = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--swipe-edge'),
  )

  return Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
}

function isStylus(touch: Touch): boolean {
  return (touch as Touch & { touchType?: string }).touchType === 'stylus'
}
