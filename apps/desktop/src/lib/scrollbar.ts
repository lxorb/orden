/** A scrollbar of our own, over any scroller in the app.
 *
 *  The platform's bar cannot be animated, and on a desktop it reserves a gutter
 *  of the writing column for itself. This one is drawn over the content: it
 *  follows the scroll by transform alone, keeps out of the way while nothing is
 *  moving, and eases into its new shape when what is underneath it becomes
 *  another note rather than jumping there.
 *
 *  The same bar everywhere, so the note, the file list and the settings all
 *  scroll the same way. The look is in themes/base.css. */

import { reading } from './direction'
import { dur } from './motion'

/** The shortest a thumb may be, so a very long note still has something a
 *  pointer can grab. */
const LEAST = 28

/** How long after the last movement the bar takes itself away. */
const IDLE = 900

/** How long a change asked for by `settle` is eased rather than jumped. Longer
 *  than the easing itself, so the scroll the switch causes - which arrives a
 *  frame or two later - is eased too. */
const SETTLING = 260

/** A scroller as the maths sees it. All in pixels. */
export interface Track {
  /** How far the content runs. */
  content: number
  /** How much of it is on screen. */
  visible: number
  /** How far down the reader is. */
  at: number
  /** How long the bar is. */
  track: number
  /** The shortest the thumb may be. */
  least: number
}

export interface Thumb {
  size: number
  offset: number
}

/** The thumb for a scroller, or null when it all fits and there is nothing to
 *  say. The offset is clamped, because a rubber-band scroll on a touchpad puts
 *  the scroller briefly past either end. */
export function thumbFor(track: Track): Thumb | null {
  const scrolled = track.content - track.visible
  if (scrolled <= 1 || track.track <= 0) return null

  const size = Math.min(
    track.track,
    Math.max(track.least, (track.visible / track.content) * track.track),
  )
  const room = Math.max(0, track.track - size)
  const along = Math.min(Math.max(track.at, 0), scrolled) / scrolled

  return { size, offset: along * room }
}

/** How far the content moves for one pixel the thumb is dragged. Zero when there
 *  is no room to drag it in, which is a thumb that fills its track. */
export function contentPerThumb(track: Track): number {
  const thumb = thumbFor(track)
  const room = thumb ? track.track - thumb.size : 0

  return room > 0 ? (track.content - track.visible) / room : 0
}

export interface OverlayScrollbar {
  /** Eases the thumb to where it should be rather than putting it there: what is
   *  under the bar has become another note, so the bar is describing something
   *  else now and should be seen to change its mind. Shows it while it does,
   *  since a change nobody sees is not worth easing. */
  settle(): void
  /** Takes the bar off the page. */
  stop(): void
}

/** Puts a bar over `scroller`. `host` is the box the bar is placed inside, and
 *  has to be an ancestor that holds the scroller; the scroller's own parent is
 *  what the action below hands over. */
export function overlayScrollbar(scroller: HTMLElement, host: HTMLElement): OverlayScrollbar {
  const bar = document.createElement('div')
  bar.className = 'nib-scrollbar'
  const thumb = document.createElement('div')
  thumb.className = 'nib-scrollbar-thumb'
  bar.append(thumb)

  // The bar is measured from the host's box, so the host needs one. Given here
  // rather than in every stylesheet that has a scroller in it.
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  host.append(bar)
  // What hides the platform's own bar, and only where ours is.
  scroller.classList.add('nib-scrolls')

  /** The bar's own box, so it is only written when it has actually moved. `end`
   *  is the gap on the side the lines end on, which is the right of the glass in
   *  English and the left of it in Arabic: a reader's own scrollbar sits at the
   *  end of the line, the way the platform's does. */
  const box = { top: -1, height: -1, end: -1 }
  let frame = 0
  let hiding: ReturnType<typeof setTimeout> | undefined
  let easing: ReturnType<typeof setTimeout> | undefined
  let held = false

  /** Everything read from the layout, in one go and before anything is written
   *  to it: a read after a write is what makes the browser lay the page out
   *  again there and then. */
  const draw = () => {
    frame = 0

    const visible = scroller.clientHeight
    const top = scroller.offsetTop
    // Both gaps are physical - `offsetLeft` counts from the left of the box
    // whichever way it reads - so which of them is the end of the line is asked
    // once, here.
    const end =
      reading() === 'rtl'
        ? scroller.offsetLeft
        : host.clientWidth - scroller.offsetLeft - scroller.clientWidth
    const shape = thumbFor({
      content: scroller.scrollHeight,
      visible,
      at: scroller.scrollTop,
      track: visible,
      least: LEAST,
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

  /** Once a frame at most, and never straight from a scroll event: a scroll
   *  event fires many times a frame and each one would be a layout read. */
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  const light = () => {
    bar.classList.add('is-lit')
    clearTimeout(hiding)
    if (!held) hiding = setTimeout(() => bar.classList.remove('is-lit'), IDLE)
  }

  const onScroll = () => {
    soon()
    light()
  }

  /** Dragging the thumb. The pointer is captured, so a drag that wanders off the
   *  bar - which is 10 pixels wide - carries on rather than stopping dead. */
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
  // The content grows and shrinks under the bar - a note typed into, a list
  // filtered - and the thumb has to grow and shrink with it.
  const watching = new ResizeObserver(soon)
  watching.observe(scroller)
  soon()

  return {
    settle: () => {
      bar.classList.add('is-settling')
      clearTimeout(easing)
      // The class is what turns the easing on, so the timer that takes it off
      // has to go the same way the easing does; see motion.ts.
      easing = setTimeout(() => bar.classList.remove('is-settling'), dur(SETTLING))
      soon()
      light()
    },
    stop: () => {
      cancelAnimationFrame(frame)
      clearTimeout(hiding)
      clearTimeout(easing)
      watching.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('pointerenter', light)
      thumb.removeEventListener('pointerdown', grab)
      scroller.classList.remove('nib-scrolls')
      bar.remove()
    },
  }
}

/** `use:scrollbar` on anything that scrolls. The parameter is anything that
 *  changes when the content does - which panel is showing, which pane of the
 *  settings - so the thumb eases to its new shape instead of jumping. */
export function scrollbar(node: HTMLElement, _showing?: unknown) {
  const bar = overlayScrollbar(node, node.parentElement ?? node)

  return {
    update: () => bar.settle(),
    destroy: () => bar.stop(),
  }
}
