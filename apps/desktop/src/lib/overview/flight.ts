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

/** The styles of a window `wide` by `tall` at `pose`, and of the tab's face inside it,
 *  on a canvas the camera draws `zoom` times its size: the tab's face is drawn at the
 *  tab's own size on the screen, whatever either scale is. */
export function drawn(pose: Pose, wide: number, tall: number, corner: number, zoom = 1) {
  const sx = Math.max(pose.w, 1) / wide
  const sy = Math.max(pose.h, 1) / tall
  const tab = clamp(pose.tab)
  const radius = corner + (TAB_RADIUS - corner) * tab
  return {
    window: {
      transform: `translate(${pose.x}px, ${pose.y}px) scale(${sx}, ${sy})`,
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
