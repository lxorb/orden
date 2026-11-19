import { dur, afterQuiet, onceAFrame } from '../../platform/src/api'

const LEAST = 28
const IDLE = 900
const SETTLING = 260
export interface Track {
  content: number
  visible: number
  at: number
  track: number
  least: number
  slack?: number
}
export interface Thumb {
  size: number
  offset: number
}
export function thumbFor(track: Track): Thumb | null {
  const scrolled = track.content - track.visible
  if (scrolled - (track.slack ?? 0) <= 1 || track.track <= 0) return null
  const size = Math.min(track.track, Math.max(track.least, (track.visible / track.content) * track.track))
  const room = Math.max(0, track.track - size)
  const along = Math.min(Math.max(track.at, 0), scrolled) / scrolled
  return { size, offset: along * room }
}
export function contentPerThumb(track: Track): number {
  const thumb = thumbFor(track)
  const room = thumb ? track.track - thumb.size : 0
  return room > 0 ? (track.content - track.visible) / room : 0
}
export interface OverlayScrollbar {
  settle(): void
  stop(): void
}
interface Drawing {
  measure(): void
  paint(): void
}
interface Fresh {
  scroller: HTMLElement
  host: HTMLElement | null
}
const freshening = new Map<HTMLElement, Fresh>()
const drawing = new Set<Drawing>()
function engineBarsRedrawn(fresh: readonly Fresh[]) {
  const placed = fresh.map(({ host }) => !host || getComputedStyle(host).position !== 'static')
  const kept = fresh.map(({ scroller }) => [scroller.style.overflowX, scroller.style.overflowY] as const)
  fresh.forEach(({ scroller, host }, at) => {
    if (host && !placed[at]) host.style.position = 'relative'
    scroller.style.overflow = 'hidden'
  })
  fresh[0]?.scroller.getBoundingClientRect()
  fresh.forEach(({ scroller }, at) => {
    const [overflowX = '', overflowY = ''] = kept[at] ?? []
    scroller.style.overflowX = overflowX
    scroller.style.overflowY = overflowY
  })
}
const frame = onceAFrame(() => {
  const fresh = [...freshening.values()].filter(({ scroller }) => scroller.isConnected)
  freshening.clear()
  engineBarsRedrawn(fresh)
  const now = [...drawing]
  drawing.clear()
  for (const one of now) one.measure()
  for (const one of now) one.paint()
})
function freshen(scroller: HTMLElement, host: HTMLElement | null) {
  freshening.set(scroller, { scroller, host: host ?? freshening.get(scroller)?.host ?? null })
  frame()
}
export function overlayScrollbar(scroller: HTMLElement, host: HTMLElement): OverlayScrollbar {
  const bar = document.createElement('div')
  bar.className = 'orden-scrollbar'
  const thumb = document.createElement('div')
  thumb.className = 'orden-scrollbar-thumb'
  bar.append(thumb)
  host.append(bar)
  scroller.classList.add('orden-scrolls')
  freshen(scroller, host)
  const shown = { top: -1, height: -1, end: -1, needed: false, size: -1, offset: -1 }
  let seen: { top: number; height: number; end: number; thumb: Thumb | null } | null = null
  let held = false
  let stopped = false
  const measure = () => {
    const visible = scroller.clientHeight
    seen = {
      top: scroller.offsetTop,
      height: visible,
      end: host.clientWidth - scroller.offsetLeft - scroller.clientWidth,
      thumb: thumbFor({
        content: scroller.scrollHeight,
        visible,
        at: scroller.scrollTop,
        track: visible,
        least: LEAST,
        slack: parseFloat(getComputedStyle(scroller).paddingBottom) || 0,
      }),
    }
  }
  const paint = () => {
    if (!seen || stopped) return
    const { top, height, end } = seen
    if (shown.top !== top || shown.height !== height || shown.end !== end) {
      Object.assign(shown, { top, height, end })
      bar.style.top = `${top}px`
      bar.style.height = `${height}px`
      bar.style.insetInlineEnd = `${end}px`
    }
    const needed = !!seen.thumb
    if (shown.needed !== needed) {
      shown.needed = needed
      bar.classList.toggle('is-needed', needed)
    }
    if (!seen.thumb) return
    const size = Math.round(seen.thumb.size)
    const offset = Math.round(seen.thumb.offset)
    if (shown.size !== size) thumb.style.height = `${(shown.size = size)}px`
    if (shown.offset !== offset) thumb.style.transform = `translateY(${(shown.offset = offset)}px)`
  }
  const drawn: Drawing = { measure, paint }
  const soon = () => {
    if (stopped) return
    drawing.add(drawn)
    frame()
  }
  const dimming = afterQuiet(() => bar.classList.remove('is-lit'), IDLE)
  const easing = afterQuiet(
    () => bar.classList.remove('is-settling'),
    () => dur(SETTLING),
  )
  const light = () => {
    soon()
    bar.classList.add('is-lit')
    dimming.cancel()
    if (!held) dimming()
  }
  const onScroll = () => {
    soon()
    light()
  }
  const grab = (event: PointerEvent) => {
    const visible = scroller.clientHeight
    const each = contentPerThumb({
      content: scroller.scrollHeight,
      visible,
      at: scroller.scrollTop,
      track: visible,
      least: LEAST,
    })
    if (!each) return
    event.preventDefault()
    thumb.setPointerCapture(event.pointerId)
    held = true
    bar.classList.add('is-held')
    light()
    const from = { y: event.clientY, at: scroller.scrollTop }
    const move = (moved: PointerEvent) => {
      scroller.scrollTop = from.at + (moved.clientY - from.y) * each
    }
    const done = () => {
      held = false
      bar.classList.remove('is-held')
      light()
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', done)
      thumb.removeEventListener('pointercancel', done)
    }
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', done)
    thumb.addEventListener('pointercancel', done)
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  scroller.addEventListener('pointerenter', light)
  thumb.addEventListener('pointerdown', grab)
  const watching = new ResizeObserver(soon)
  watching.observe(scroller)
  soon()
  return {
    settle: () => {
      bar.classList.add('is-settling')
      easing()
      soon()
      light()
    },
    stop: () => {
      stopped = true
      drawing.delete(drawn)
      dimming.cancel()
      easing.cancel()
      watching.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('pointerenter', light)
      thumb.removeEventListener('pointerdown', grab)
      scroller.classList.remove('orden-scrolls')
      freshen(scroller, null)
      bar.remove()
    },
  }
}
export function scrollbar(node: HTMLElement, _showing?: unknown) {
  const bar = overlayScrollbar(node, node.parentElement ?? node)
  return {
    update: () => bar.settle(),
    destroy: () => bar.stop(),
  }
}
