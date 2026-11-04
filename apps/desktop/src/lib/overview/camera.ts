/** Where the overview's canvas is looked at from: how far it is moved and how near it is
 *  (issue #331).
 *
 *  The windows lie on one canvas for every space, each space where it was put (see
 *  places.svelte.ts), and the screen is a window onto it. A point on the canvas is drawn
 *  at `point * zoom + (x, y)`. The wheel and two fingers on a touchpad move it, a pinch
 *  or Ctrl and the wheel bring it nearer about the point under the hand, and it opens on
 *  the space being worked in. Pure. */

import type { Box } from './layout'

export interface Camera {
  x: number
  y: number
  zoom: number
}

/** As far out as a canvas of several spaces needs, and as near as a window can come
 *  before it is the pane again. */
export const NEAREST = 2.5
export const FARTHEST = 0.2

export interface Point {
  x: number
  y: number
}

/** A point of the screen, on the canvas. */
export function toCanvas(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }
}

/** A box of the screen, on the canvas. */
export function boxToCanvas(camera: Camera, box: Box): Box {
  const { x, y } = toCanvas(camera, box)
  return { x, y, w: box.w / camera.zoom, h: box.h / camera.zoom }
}

/** Looking at `what` on the canvas so that it fills `room` on the screen: one to one where
 *  it fits, smaller where it was placed in a larger window than this one, and in the
 *  middle. */
export function lookingAt(what: Box, room: Box): Camera {
  const zoom = Math.min(1, room.w / Math.max(what.w, 1), room.h / Math.max(what.h, 1))
  return {
    x: room.x + (room.w - what.w * zoom) / 2 - what.x * zoom,
    y: room.y + (room.h - what.h * zoom) / 2 - what.y * zoom,
    zoom,
  }
}

/** Brought nearer by `factor` about `point` on the screen, which stays where it is. */
export function zoomedAt(camera: Camera, point: Point, factor: number): Camera {
  const zoom = Math.min(NEAREST, Math.max(FARTHEST, camera.zoom * factor))
  const at = toCanvas(camera, point)
  return { x: point.x - at.x * zoom, y: point.y - at.y * zoom, zoom }
}

export function moved(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

/** What a turn of the wheel says, as much of one as this reads. */
export interface Turn {
  deltaX: number
  deltaY: number
  /** 0 for pixels, 1 for lines, 2 for pages. */
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  x: number
  y: number
}

/** A line of a wheel, in pixels, and a page. */
const LINE = 40
const PAGE = 800

/** How sharply a pinch, which Chromium says as Ctrl and the wheel, brings it nearer, and
 *  the most one turn may count: a notch of a mouse's wheel with Ctrl is a hundred
 *  pixels at once, where a pinch says a few at a time. */
const PINCH = 0.01
const MOST = 40

/** Whether a turn with Ctrl or Cmd is a notch of a mouse's wheel rather than a pinch:
 *  a notch says lines, or a hundred pixels or so at once, where a pinch says a few at a
 *  time and rarely whole ones. A notch is eased towards (`eased`); a pinch follows the
 *  fingers one to one. */
export function isNotch(turn: Turn): boolean {
  return turn.deltaMode !== 0 || (Math.abs(turn.deltaY) >= 50 && Number.isInteger(turn.deltaY))
}

/** How much nearer a pixel of a notch brings the zoom it aims at: a notch of a hundred is
 *  about a fifth, as a browser's own zoom is. */
const NOTCH = 0.002

/** The zoom a notch aims at, from the one aimed at before it, so notches in quick
 *  succession add up rather than each starting from where the camera has got to. */
export function notched(goal: number, turn: Turn): number {
  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? PAGE : 1
  return Math.min(NEAREST, Math.max(FARTHEST, goal * Math.exp(-turn.deltaY * unit * NOTCH)))
}

/** How quickly an eased zoom closes on its goal: most of the way in a sixth of a second. */
const EASE = 0.08

/** The camera `seconds` further on its way to `zoom` about `at` on the screen, which
 *  stays where it is: the same share of the way, in the zoom's own scale, every moment,
 *  so it starts at once and settles softly. There once it is within three thousandths. */
export function eased(camera: Camera, zoom: number, at: Point, seconds: number): Camera {
  const gap = Math.log(zoom / camera.zoom)
  const next =
    Math.abs(gap) < 0.003 ? zoom : camera.zoom * Math.exp(gap * (1 - Math.exp(-seconds / EASE)))
  return zoomedAt(camera, at, next / camera.zoom)
}

/** The camera after a turn of the wheel: two fingers on a touchpad and the wheel move
 *  the canvas; a pinch, or Ctrl or Cmd with the wheel, zooms about the pointer. */
export function turned(camera: Camera, turn: Turn): Camera {
  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? PAGE : 1
  const dx = turn.deltaX * unit
  const dy = turn.deltaY * unit
  if (turn.ctrlKey || turn.metaKey) {
    const step = Math.max(-MOST, Math.min(MOST, dy))
    return zoomedAt(camera, turn, Math.exp(-step * PINCH))
  }
  return moved(camera, -dx, -dy)
}

/** Two fingers on the glass, then and now: moved by where their middle went, and nearer
 *  by how much further apart they are. */
export function pinched(camera: Camera, before: [Point, Point], after: [Point, Point]): Camera {
  const middle = (two: [Point, Point]) => ({
    x: (two[0].x + two[1].x) / 2,
    y: (two[0].y + two[1].y) / 2,
  })
  const apart = (two: [Point, Point]) =>
    Math.max(Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y), 1)
  const from = middle(before)
  const to = middle(after)
  const zoomed = zoomedAt(camera, from, apart(after) / apart(before))
  return moved(zoomed, to.x - from.x, to.y - from.y)
}

/** Moved just far enough that `what` on the canvas is inside `room` on the screen: the
 *  window the arrows walked to, brought into view. */
export function showing(camera: Camera, what: Box, room: Box): Camera {
  const left = what.x * camera.zoom + camera.x
  const top = what.y * camera.zoom + camera.y
  const right = left + what.w * camera.zoom
  const bottom = top + what.h * camera.zoom
  const dx = left < room.x ? room.x - left : right > room.x + room.w ? room.x + room.w - right : 0
  const dy = top < room.y ? room.y - top : bottom > room.y + room.h ? room.y + room.h - bottom : 0
  return moved(camera, dx, dy)
}
