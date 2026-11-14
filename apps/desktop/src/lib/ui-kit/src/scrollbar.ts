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

  const size = Math.min(
    track.track,
    Math.max(track.least, (track.visible / track.content) * track.track),
  )
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

function engineBarRedrawn(scroller: HTMLElement) {
  const { overflowX, overflowY } = scroller.style
  scroller.style.overflow = 'hidden'
  scroller.getBoundingClientRect()
  scroller.style.overflowX = overflowX
  scroller.style.overflowY = overflowY
}

export function overlayScrollbar(scroller: HTMLElement, host: HTMLElement): OverlayScrollbar {
  const bar = document.createElement('div')
  bar.className = 'orden-scrollbar'
  const thumb = document.createElement('div')
  thumb.className = 'orden-scrollbar-thumb'
  bar.append(thumb)

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  host.append(bar)
  scroller.classList.add('orden-scrolls')
  engineBarRedrawn(scroller)

  const box = { top: -1, height: -1, end: -1 }
  let held = false

  const draw = () => {
    const visible = scroller.clientHeight
    const top = scroller.offsetTop
    const end = host.clientWidth - scroller.offsetLeft - scroller.clientWidth
    const shape = thumbFor({
      content: scroller.scrollHeight,
      visible,
      at: scroller.scrollTop,
      track: visible,
      least: LEAST,
      slack: parseFloat(getComputedStyle(scroller).paddingBottom) || 0,
    })

    if (box.top !== top || box.height !== visible || box.end !== end) {
      Object.assign(box, { top, height: visible, end })
      bar.style.top = `${top}px`
      bar.style.height = `${visible}px`
      bar.style.insetInlineEnd = `${end}px`
    }

    bar.classList.toggle('is-needed', !!shape)
    if (!shape) return

    thumb.style.height = `${Math.round(shape.size)}px`
    thumb.style.transform = `translateY(${Math.round(shape.offset)}px)`
  }

  const soon = onceAFrame(draw)

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
      soon.cancel()
      dimming.cancel()
      easing.cancel()
      watching.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('pointerenter', light)
      thumb.removeEventListener('pointerdown', grab)
      scroller.classList.remove('orden-scrolls')
      engineBarRedrawn(scroller)
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
