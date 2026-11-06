/** One window of the overview in the air: where it is, how it is drawn there, and the
 *  springs that carry it (issue #331).
 *
 *  A window is one element from the tab it was to the window it is, never two crossing
 *  over: the element is laid out once at the size of its place on the canvas, and every
 *  frame only moves and scales it, so the browser composites and lays nothing out. While
 *  it is still tab-shaped its face gives way to the tab's own mark and name, drawn at the
 *  tab's size by scaling them back by as much as the window is scaled.
 *
 *  `pose` is a place and a look, `Flight` the springs; `drawn` turns a pose into the
 *  styles. Pure but for the element it writes to. */

import { type Feel, FLIGHT, land, resting, SHARE, type Spring, spring, step } from './spring'

/** Where a window is and how much of a tab it still is. */
export interface Pose {
  x: number
  y: number
  w: number
  h: number
  /** 1 is the tab in the strip, 0 the window on the canvas. */
  tab: number
  /** How much of it is there at all. */
  alpha: number
}

const KEYS = ['x', 'y', 'w', 'h', 'tab', 'alpha'] as const

/** A window's corner, and a tab's. */
/** A tab's corner, which a window has while it is still tab-shaped. A window's own is
 *  the card's, the frame's token (`--card-radius` in tokens.css, #1088): a pane's card
 *  and the window it becomes are one shape. */
const TAB_RADIUS = 8

export class Flight {
  private readonly springs: Record<keyof Pose, Spring>

  constructor(from: Pose) {
    this.springs = {
      x: spring(from.x),
      y: spring(from.y),
      w: spring(from.w),
      h: spring(from.h),
      tab: spring(from.tab, SHARE),
      alpha: spring(from.alpha, SHARE),
    }
  }

  /** Where it is pulled to now. Its speed is kept, so a change of mind bends the path. */
  aim(to: Pose) {
    for (const key of KEYS) this.springs[key].to = to[key]
  }

  /** Holds its corner at `x`, `y`, under a hand: no spring between the pointer and the
   *  window. Its size still springs to `w` by `h`, the place it would land in. */
  hold(x: number, y: number, w: number, h: number) {
    for (const [key, value] of [
      ['x', x],
      ['y', y],
    ] as const) {
      const one = this.springs[key]
      one.at = one.to = value
      one.speed = 0
    }
    this.springs.w.to = w
    this.springs.h.to = h
    this.springs.tab.to = 0
    this.springs.alpha.to = 1
  }

  /** Puts it where it is pulled to, with no movement. */
  land() {
    for (const key of KEYS) land(this.springs[key])
  }

  /** Moves it on. True once it has arrived. */
  step(seconds: number, feel: Feel = FLIGHT): boolean {
    let still = true
    for (const key of KEYS) {
      step(this.springs[key], seconds, feel)
      still &&= resting(this.springs[key])
    }
    return still
  }

  get pose(): Pose {
    const { x, y, w, h, tab, alpha } = this.springs
    return { x: x.at, y: y.at, w: w.at, h: h.at, tab: tab.at, alpha: alpha.at }
  }

  get resting(): boolean {
    return KEYS.every((key) => resting(this.springs[key]))
  }
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function drawn(
  pose: Pose,
  wide: number,
  tall: number,
  corner: number,
  camera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 },
) {
  const { zoom } = camera
  const sx = Math.max(pose.w, 1) / wide
  const sy = Math.max(pose.h, 1) / tall
  const tab = clamp(pose.tab)
  const radius = corner + (TAB_RADIUS - corner) * tab
  const x = camera.x + pose.x * zoom
  const y = camera.y + pose.y * zoom
  return {
    window: {
      transform: `translate(${x}px, ${y}px) scale(${sx * zoom}, ${sy * zoom})`,
      borderRadius: `${radius / sx}px / ${radius / sy}px`,
      opacity: String(clamp(pose.alpha)),
    },
    // The face gives way in the last stretch towards the tab, so a window is a window
    // nearly all the way home.
    face: { opacity: String(clamp(1 - (tab - 0.35) / 0.55)) },
    chip: {
      opacity: String(clamp((tab - 0.35) / 0.55)),
      width: `${Math.max(pose.w, 1) * zoom}px`,
      height: `${Math.max(pose.h, 1) * zoom}px`,
      transform: `scale(${1 / (sx * zoom)}, ${1 / (sy * zoom)})`,
    },
  }
}

/** Where a pane is drawn as its own window (issue #331): the pane itself, laid out where
 *  it always is (`box`, on the screen, its strip `head` tall at the top), moved and made
 *  small so that what it shows - all of it under the strip - lies exactly on the window's
 *  `pose` on the canvas the camera looks at. It keeps its shape: made the window's width,
 *  and cut off at the window's foot where the window is the shorter, at the window's
 *  corner. Its strip is cut away as far as the overview is `open`, so on the first frame
 *  and the last the pane is the pane as it is laid out, strip and all. */
export function paneDrawn(
  pose: Pose,
  camera: { x: number; y: number; zoom: number },
  box: { x: number; y: number; width: number; height: number },
  head: number,
  corner: number,
  open: number,
) {
  const x = camera.x + pose.x * camera.zoom
  const y = camera.y + pose.y * camera.zoom
  const w = Math.max(pose.w * camera.zoom, 1)
  const h = Math.max(pose.h * camera.zoom, 1)
  const scale = w / Math.max(box.width, 1)
  const shown = Math.max(box.height - head, 1)
  const cut = head * clamp(open)
  const below = Math.max(0, shown - h / scale)
  return {
    transform: `translate(${x - box.x}px, ${y - box.y - scale * head}px) scale(${scale})`,
    clipPath: `inset(${cut}px 0 ${below}px 0 round ${corner / scale}px)`,
    opacity: String(clamp(pose.alpha)),
  }
}
