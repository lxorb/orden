/** Where a plane is being looked at from, and what is under the pointer.
 *
 *  One transform, in one place: the paint, the pointer and the hit test all read
 *  it, so a click cannot land somewhere other than where the thing is drawn. The
 *  camera says which point of the plane is at the middle of the view and how many
 *  pixels a unit of the plane is worth.
 *
 *  Two surfaces read it. The graph draws itself on a 2d context and applies the
 *  camera per node; the canvas puts its nodes in the page and applies it once, as
 *  one css transform. Neither knows anything about the other, and the arithmetic
 *  they agree on is here. */

export interface Camera {
  /** The point of the plane the middle of the view is on. */
  x: number
  y: number
  /** Pixels per unit of the plane. */
  scale: number
  /** How far the view is turned about the middle of the pane, in radians, clockwise
   *  on screen; absent is upright. A canvas turned by two fingers (#351) and nothing
   *  else: the graph and a page note are always upright. */
  turn?: number
}

/** A camera's turn, upright where it has none. */
export function turnOf(camera: Camera): number {
  return camera.turn ?? 0
}

/** A turn in (-π, π], so a view turned all the way round is upright again rather
 *  than a number that grows. */
export function settledTurn(turn: number): number {
  let angle = turn % (2 * Math.PI)
  if (angle > Math.PI) angle -= 2 * Math.PI
  if (angle <= -Math.PI) angle += 2 * Math.PI
  return Math.abs(angle) < 1e-9 ? 0 : angle
}

/** An offset turned by an angle, clockwise on screen. */
export function turnedBy(x: number, y: number, angle: number): { x: number; y: number } {
  if (!angle) return { x, y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/** How far in and out the view goes. Far enough out that a space of thousands of
 *  notes fits, far enough in to read one name at a comfortable size. */
export const CLOSEST = 4
export const FURTHEST = 0.04

/** How small a node may get on screen however far out the view is, so a distant
 *  note is still a dot rather than nothing. */
export const SMALLEST_DOT = 1.1

export function clampScale(scale: number): number {
  return Math.min(CLOSEST, Math.max(FURTHEST, scale))
}

/** One notch of a zoom: what a button on the bar steps by, and what one notch of a
 *  wheel held with Ctrl comes to.
 *
 *  One number, here, because a reader who zooms with the buttons and then with the
 *  wheel is zooming the same paper: the bar's own comment already said the two
 *  agree, and they did not - the buttons stepped by a fifth, the plane's wheel by
 *  two fifths and a page note's by a quarter. */
export const NOTCH = 1.2

/** What a wheel does to the scale.
 *
 *  Ctrl and the wheel is a zoom on every platform, and so is a trackpad pinch,
 *  which arrives as exactly that. A notch of a real wheel is a hundred pixels of
 *  delta, so that is what `NOTCH` is spelled against; a trackpad sends dozens of
 *  small ones and they multiply up to the same thing over the same distance, which
 *  is the whole reason this is an exponential rather than a step. */
export function wheelZoom(deltaY: number): number {
  return Math.exp((-deltaY / 100) * Math.log(NOTCH))
}

/** What one Ctrl-wheel event does to the scale: a wheel's notch, or a trackpad's pinch,
 *  which follows the fingers (#410). Chromium and WebView2 send a pinch as Ctrl and the
 *  wheel in small fractional steps, each a hundred times the log of how far the fingers
 *  moved apart, so read as notches a pinch to twice the span zoomed an eighth. A wheel's
 *  notch is a whole hundred, or a whole share of one at a display's own scale. */
export function ctrlWheelZoom(event: { deltaY: number; deltaMode: number }): number {
  const pinch =
    event.deltaMode === 0 && Math.abs(event.deltaY) < PINCHED && !Number.isInteger(event.deltaY)
  return pinch ? Math.exp(-event.deltaY / 100) : wheelZoom(event.deltaY)
}

/** Below this, a fractional Ctrl-wheel step is a pinch rather than a wheel's notch. */
const PINCHED = 50

/** WebKit's trackpad pinch on a Mac: the scale since the pinch began, where it is. */
interface Gesture extends UIEvent {
  scale: number
  /** Degrees, clockwise, since the gesture began; WebKit's own. */
  rotation?: number
  clientX: number
  clientY: number
}

/** Whether a WebKit pinch is going on, whose Ctrl-wheel would be counted twice. */
let gesturing = false

export function pinching(): boolean {
  return gesturing
}

/** A trackpad pinch as WebKit on a Mac tells it, which is not as a wheel but as
 *  `gesturestart`, `gesturechange` and `gestureend` (#410): each change zooms by what the
 *  fingers moved since the last, about the point between them, and the page's own zoom is
 *  stopped. Answers how to stop listening. */
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
    // And the turn of the two fingers, where the surface turns at all (#351).
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

/** How far two fingers have to turn before the view turns with them, in radians:
 *  six degrees, which a pinch held a little crooked never reaches and a turn meant as
 *  one passes in its first moment (#351). */
export const TURN_DEADBAND = (6 * Math.PI) / 180

/** A turn of two fingers as it goes: nothing until it has passed the deadband, and
 *  from there every change of angle, so the view does not jump by the deadband the
 *  moment it starts to follow. */
export class Twist {
  private began: number | null = null
  private last = 0
  private going = false

  /** The angle the fingers are at now, from where they began; answers how much to
   *  turn the view by since the last. */
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

/** How far either side of upright, and of each right angle, the rotation snap holds a
 *  turned canvas, in radians (#487): twenty degrees of twist before it moves at all,
 *  which only a turn that is meant gets past. */
export const TURN_SNAP = (20 * Math.PI) / 180

/** A right angle, and how much faster than the fingers the view turns once past the
 *  snap: enough to meet them again halfway to the next right angle, so it never jumps. */
const RIGHT = Math.PI / 2
const STRETCH = RIGHT / 2 / (RIGHT / 2 - TURN_SNAP)

/** The turn a view is shown at for the turn two fingers have made: the nearest right
 *  angle within the snap of it, and past the snap, stretched to meet the fingers. */
export function snapped(twisted: number): number {
  const right = Math.round(twisted / RIGHT) * RIGHT
  const off = twisted - right
  return settledTurn(right + Math.sign(off) * Math.max(0, Math.abs(off) - TURN_SNAP) * STRETCH)
}

/** `snapped` the other way round: the twist that shows a turn, and for a right angle
 *  the right angle itself. */
export function unsnapped(turn: number): number {
  const right = Math.round(turn / RIGHT) * RIGHT
  const off = turn - right
  return right + Math.sign(off) * (TURN_SNAP + Math.abs(off) / STRETCH)
}

/** The point of the plane a screen point is over. */
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

/** Where a point of the plane is on screen: `graphPoint` the other way round. */
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

/** The camera moved by a drag of the screen: the plane goes with the hand, whichever
 *  way the view is turned. */
export function panned(camera: Camera, dx: number, dy: number): Camera {
  const by = turnedBy(dx, dy, -turnOf(camera))
  return { ...camera, x: camera.x - by.x / camera.scale, y: camera.y - by.y / camera.scale }
}

/** The camera turned about a screen point by an angle, keeping what is under that
 *  point under it: two fingers turn the plane about the point between them. */
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

/** A camera that puts a rectangle of the plane in view with `padding` pixels to
 *  spare. Something small enough to fit at its natural size is not blown up to
 *  fill the view: it would read as a balloon.
 *
 *  Takes the rectangle rather than the things in it, so the two surfaces can each
 *  work out their own extent: a graph node is a point, a canvas node is a box. */
export function framingBox(
  box: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  padding: number,
): Camera {
  if (width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  const across = Math.max(box.width, 1)
  const down = Math.max(box.height, 1)
  const room = Math.min(
    (width - 2 * padding) / across,
    (height - 2 * padding) / down,
    // One pixel per unit is as close as framing goes; getting closer is the
    // reader's business.
    1,
  )

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    scale: clampScale(room),
  }
}

/** A camera that frames every point with `padding` pixels to spare.
 *
 *  `shown` leaves out the points that are not being drawn - a graph narrowed by a
 *  filter frames what it is showing rather than the space it came out of - and an
 *  empty answer falls back to framing the lot, since a view with nothing in it has
 *  nothing to be about. */
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

/** The camera after a scroll at a point, which keeps whatever was under the
 *  pointer under it. */
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

/** Which node a screen point is on, or -1 for none. The nearest one whose drawn
 *  circle the point falls in, with `slack` pixels of forgiveness so a small dot
 *  can still be hit by a hand rather than a machine. */
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
