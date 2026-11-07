import type { Box } from './layout'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const NEAREST = 2.5
export const FARTHEST = 0.2

export interface Point {
  x: number
  y: number
}

export function toCanvas(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }
}

export function boxToCanvas(camera: Camera, box: Box): Box {
  const { x, y } = toCanvas(camera, box)
  return { x, y, w: box.w / camera.zoom, h: box.h / camera.zoom }
}

export function lookingAt(what: Box, room: Box): Camera {
  const zoom = Math.min(1, room.w / Math.max(what.w, 1), room.h / Math.max(what.h, 1))
  return {
    x: room.x + (room.w - what.w * zoom) / 2 - what.x * zoom,
    y: room.y + (room.h - what.h * zoom) / 2 - what.y * zoom,
    zoom,
  }
}

const READABLE = 240

type Span = readonly [start: number, size: number]

function along(here: Span, whole: Span, room: Span, zoom: number): number {
  const [from, inside] = room
  if (whole[1] * zoom <= inside) return from + (inside - whole[1] * zoom) / 2 - whole[0] * zoom
  const centred = from + inside / 2 - (here[0] + here[1] / 2) * zoom
  const least = from + inside - (whole[0] + whole[1]) * zoom
  return Math.min(from - whole[0] * zoom, Math.max(least, centred))
}

export function overlooking(here: Box, whole: Box, room: Box, window: number): Camera {
  const near = lookingAt(here, room).zoom
  const far = Math.min(near, lookingAt(whole, room).zoom)
  const most = Math.max(far, FARTHEST, READABLE / Math.max(window, 1), Math.sqrt(near * far))
  const zoom = Math.min(near, most)
  return {
    x: along([here.x, here.w], [whole.x, whole.w], [room.x, room.w], zoom),
    y: along([here.y, here.h], [whole.y, whole.h], [room.y, room.h], zoom),
    zoom,
  }
}

export function zoomedAt(camera: Camera, point: Point, factor: number): Camera {
  const zoom = Math.min(NEAREST, Math.max(FARTHEST, camera.zoom * factor))
  const at = toCanvas(camera, point)
  return { x: point.x - at.x * zoom, y: point.y - at.y * zoom, zoom }
}

export function moved(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

export interface Turn {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  x: number
  y: number
}

const LINE = 40
const PAGE = 800

const PINCH = 0.01
const MOST = 40

export function isNotch(turn: Turn): boolean {
  return turn.deltaMode !== 0 || (Math.abs(turn.deltaY) >= 50 && Number.isInteger(turn.deltaY))
}

const NOTCH = 0.002

export function notched(goal: number, turn: Turn): number {
  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? PAGE : 1
  return Math.min(NEAREST, Math.max(FARTHEST, goal * Math.exp(-turn.deltaY * unit * NOTCH)))
}

const EASE = 0.08
const FOLLOW = 0.035

export function eased(
  camera: Camera,
  zoom: number,
  at: Point,
  seconds: number,
  ease = EASE,
): Camera {
  const gap = Math.log(zoom / camera.zoom)
  const next =
    Math.abs(gap) < 0.003 ? zoom : camera.zoom * Math.exp(gap * (1 - Math.exp(-seconds / ease)))
  return zoomedAt(camera, at, next / camera.zoom)
}

function fingered(goal: number, turn: Turn): number {
  const unit = turn.deltaMode === 1 ? LINE : turn.deltaMode === 2 ? PAGE : 1
  const dy = turn.deltaY * unit
  const step = Math.max(-MOST, Math.min(MOST, dy))
  const rate = turn.ctrlKey || turn.metaKey ? PINCH : NOTCH
  return Math.min(NEAREST, Math.max(FARTHEST, goal * Math.exp(-step * rate)))
}

export function aimed(goal: number, turn: Turn): { zoom: number; ease: number } {
  return isNotch(turn)
    ? { zoom: notched(goal, turn), ease: EASE }
    : { zoom: fingered(goal, turn), ease: FOLLOW }
}

export function turned(camera: Camera, turn: Turn): Camera {
  return zoomedAt(camera, turn, fingered(camera.zoom, turn) / camera.zoom)
}

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

export function isOnView(camera: Camera, what: Box, room: Box): boolean {
  const x = (what.x + what.w / 2) * camera.zoom + camera.x - room.x
  const y = (what.y + what.h / 2) * camera.zoom + camera.y - room.y
  return x >= 0 && x <= room.w && y >= 0 && y <= room.h
}

export function showing(camera: Camera, what: Box, room: Box): Camera {
  const left = what.x * camera.zoom + camera.x
  const top = what.y * camera.zoom + camera.y
  const right = left + what.w * camera.zoom
  const bottom = top + what.h * camera.zoom
  const dx = left < room.x ? room.x - left : right > room.x + room.w ? room.x + room.w - right : 0
  const dy = top < room.y ? room.y - top : bottom > room.y + room.h ? room.y + room.h - bottom : 0
  return moved(camera, dx, dy)
}
