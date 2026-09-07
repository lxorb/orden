/** Where the graph is being looked at from, and what is under the pointer.
 *
 *  One transform, in one place: the paint, the pointer and the hit test all read
 *  it, so a click cannot land somewhere other than where the node is drawn. The
 *  camera says which graph point is at the middle of the view and how many
 *  pixels a graph unit is worth. */

export interface Camera {
  /** The graph point the middle of the view is on. */
  x: number
  y: number
  /** Pixels per graph unit. */
  scale: number
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

/** The graph point a screen point is over. */
export function graphPoint(
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - width / 2) / camera.scale + camera.x,
    y: (screenY - height / 2) / camera.scale + camera.y,
  }
}

/** A camera that frames every node with `padding` pixels to spare. A graph small
 *  enough to fit at its natural size is not blown up to fill the view: the notes
 *  would read as balloons. */
export function framing(
  x: Float64Array,
  y: Float64Array,
  count: number,
  width: number,
  height: number,
  padding: number,
): Camera {
  if (count === 0 || width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }

  let least = Infinity
  let most = -Infinity
  let lowest = Infinity
  let highest = -Infinity

  for (let one = 0; one < count; one++) {
    const px = x[one] ?? 0
    const py = y[one] ?? 0
    if (px < least) least = px
    if (px > most) most = px
    if (py < lowest) lowest = py
    if (py > highest) highest = py
  }

  const across = Math.max(most - least, 1)
  const down = Math.max(highest - lowest, 1)
  const room = Math.min(
    (width - 2 * padding) / across,
    (height - 2 * padding) / down,
    // One pixel per unit is as close as framing goes; getting closer is the
    // reader's business.
    1,
  )

  return { x: (least + most) / 2, y: (lowest + highest) / 2, scale: clampScale(room) }
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

  return {
    x: under.x - (screenX - width / 2) / scale,
    y: under.y - (screenY - height / 2) / scale,
    scale,
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
