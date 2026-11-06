export interface Camera {
  x: number
  y: number
  scale: number
  turn?: number
}

export function turnOf(camera: Camera): number {
  return camera.turn ?? 0
}

export function settledTurn(turn: number): number {
  let angle = turn % (2 * Math.PI)
  if (angle > Math.PI) angle -= 2 * Math.PI
  if (angle <= -Math.PI) angle += 2 * Math.PI
  return Math.abs(angle) < 1e-9 ? 0 : angle
}

export function turnedBy(x: number, y: number, angle: number): { x: number; y: number } {
  if (!angle) return { x, y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

export const CLOSEST = 4
export const FURTHEST = 0.04

export const SMALLEST_DOT = 1.1

export function clampScale(scale: number): number {
  return Math.min(CLOSEST, Math.max(FURTHEST, scale))
}

export const NOTCH = 1.2

export function wheelZoom(deltaY: number): number {
  return Math.exp((-deltaY / 100) * Math.log(NOTCH))
}

export function ctrlWheelZoom(event: { deltaY: number; deltaMode: number }): number {
  const pinch =
    event.deltaMode === 0 && Math.abs(event.deltaY) < PINCHED && !Number.isInteger(event.deltaY)
  return pinch ? Math.exp(-event.deltaY / 100) : wheelZoom(event.deltaY)
}

const PINCHED = 50

interface Gesture extends UIEvent {
  scale: number
  rotation?: number
  clientX: number
  clientY: number
}

let gesturing = false

export function pinching(): boolean {
  return gesturing
}

export function heldGestures(
  element: HTMLElement,
  zoom: (at: { clientX: number; clientY: number }, by: number) => void,
  turn?: (at: { clientX: number; clientY: number }, by: number) => void,
): () => void {
  let last = 1
  let twist = new Twist()
  const start = (event: Event) => {
    event.preventDefault()
    gesturing = true
    last = 1
    twist = new Twist()
  }
  const change = (event: Event) => {
    event.preventDefault()
    const gesture = event as Gesture
    if (!gesture.scale || !last) return
    zoom(gesture, gesture.scale / last)
    last = gesture.scale
    const by = turn ? twist.to(((gesture.rotation ?? 0) * Math.PI) / 180) : 0
    if (by) turn?.(gesture, by)
  }
  const end = (event: Event) => {
    event.preventDefault()
    gesturing = false
  }
  element.addEventListener('gesturestart', start)
  element.addEventListener('gesturechange', change)
  element.addEventListener('gestureend', end)
  return () => {
    gesturing = false
    element.removeEventListener('gesturestart', start)
    element.removeEventListener('gesturechange', change)
    element.removeEventListener('gestureend', end)
  }
}

export const TURN_DEADBAND = (6 * Math.PI) / 180

export class Twist {
  private began: number | null = null
  private last = 0
  private going = false

  to(angle: number): number {
    if (this.began === null) {
      this.began = angle
      this.last = angle
      return 0
    }
    if (!this.going) {
      if (Math.abs(settledTurn(angle - this.began)) < TURN_DEADBAND) return 0
      this.going = true
    }
    const by = settledTurn(angle - this.last)
    this.last = angle
    return by
  }
}

export const TURN_SNAP = (20 * Math.PI) / 180

const RIGHT = Math.PI / 2
const STRETCH = RIGHT / 2 / (RIGHT / 2 - TURN_SNAP)

export function snapped(twisted: number): number {
  const right = Math.round(twisted / RIGHT) * RIGHT
  const off = twisted - right
  return settledTurn(right + Math.sign(off) * Math.max(0, Math.abs(off) - TURN_SNAP) * STRETCH)
}

export function unsnapped(turn: number): number {
  const right = Math.round(turn / RIGHT) * RIGHT
  const off = turn - right
  return right + Math.sign(off) * (TURN_SNAP + Math.abs(off) / STRETCH)
}

export function graphPoint(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const off = turnedBy(screenX - width / 2, screenY - height / 2, -turnOf(camera))
  return {
    x: off.x / camera.scale + camera.x,
    y: off.y / camera.scale + camera.y,
  }
}

export function screenPoint(
  camera: Camera,
  width: number,
  height: number,
  point: { x: number; y: number },
): { x: number; y: number } {
  const off = turnedBy(
    (point.x - camera.x) * camera.scale,
    (point.y - camera.y) * camera.scale,
    turnOf(camera),
  )
  return { x: off.x + width / 2, y: off.y + height / 2 }
}

export function panned(camera: Camera, dx: number, dy: number): Camera {
  const by = turnedBy(dx, dy, -turnOf(camera))
  return { ...camera, x: camera.x - by.x / camera.scale, y: camera.y - by.y / camera.scale }
}

export function turned(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  by: number,
): Camera {
  const under = graphPoint(camera, width, height, screenX, screenY)
  const turn = settledTurn(turnOf(camera) + by)
  const off = turnedBy(screenX - width / 2, screenY - height / 2, -turn)
  return {
    x: under.x - off.x / camera.scale,
    y: under.y - off.y / camera.scale,
    scale: camera.scale,
    ...(turn ? { turn } : {}),
  }
}

export function framingBox(
  box: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  padding: number,
): Camera {
  if (width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  const across = Math.max(box.width, 1)
  const down = Math.max(box.height, 1)
  const room = Math.min((width - 2 * padding) / across, (height - 2 * padding) / down, 1)

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    scale: clampScale(room),
  }
}

export function framing(
  x: Float64Array,
  y: Float64Array,
  count: number,
  width: number,
  height: number,
  padding: number,
  shown?: Uint8Array,
): Camera {
  if (count === 0 || width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  let least = Infinity
  let most = -Infinity
  let lowest = Infinity
  let highest = -Infinity
  let found = 0

  for (let one = 0; one < count; one++) {
    if (shown && !shown[one]) continue

    found++
    const px = x[one] ?? 0
    const py = y[one] ?? 0
    if (px < least) least = px
    if (px > most) most = px
    if (py < lowest) lowest = py
    if (py > highest) highest = py
  }

  if (found === 0)
    return shown ? framing(x, y, count, width, height, padding) : { x: 0, y: 0, scale: 1 }

  return framingBox(
    { x: least, y: lowest, width: most - least, height: highest - lowest },
    width,
    height,
    padding,
  )
}

export function zoomed(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  by: number,
): Camera {
  const scale = clampScale(camera.scale * by)
  const under = graphPoint(camera, width, height, screenX, screenY)
  const off = turnedBy(screenX - width / 2, screenY - height / 2, -turnOf(camera))

  return {
    x: under.x - off.x / scale,
    y: under.y - off.y / scale,
    scale,
    ...(camera.turn ? { turn: camera.turn } : {}),
  }
}

export function nodeAt(
  x: Float64Array,
  y: Float64Array,
  radii: Float64Array,
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  slack = 3,
): number {
  const count = Math.min(x.length, y.length, radii.length)
  let found = -1
  let nearest = Infinity

  for (let one = 0; one < count; one++) {
    const dx = ((x[one] ?? 0) - camera.x) * camera.scale + width / 2 - screenX
    const dy = ((y[one] ?? 0) - camera.y) * camera.scale + height / 2 - screenY
    const away = Math.sqrt(dx * dx + dy * dy)
    const reach = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * camera.scale) + slack

    if (away > reach || away > nearest) continue
    nearest = away
    found = one
  }

  return found
}
