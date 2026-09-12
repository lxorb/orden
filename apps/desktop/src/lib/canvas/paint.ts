/** Ink, painted.
 *
 *  Two layers, and the split is the whole trick. The strokes already on the
 *  plane are drawn on the lower one, which is repainted only when the ink or the
 *  camera changes; the stroke under the pen is drawn on the upper one, which is
 *  cleared and redrawn on every pointer event and holds exactly one stroke. So
 *  the cost of a pen event is one stroke's outline, whether the plane carries
 *  five strokes or five thousand, and the first pixel lands in the same frame as
 *  the event rather than after a repaint of everything.
 *
 *  A stroke's outline is worked out once and kept as a `Path2D` in plane
 *  coordinates, so panning and zooming are a transform on the context and not a
 *  recalculation of anything. The cache is keyed on the stroke object itself:
 *  every edit hands back new objects for what it touched and the very same ones
 *  for what it did not, so the cache invalidates itself and never goes stale. */

import type { Camera } from '../camera'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { INK_STYLES, inkOpacity, outlineOf, strokeBox, traceInk } from './ink'

/** Outlines already worked out. Weak, so a stroke that has been erased takes its
 *  path with it without anybody sweeping up. */
const paths = new WeakMap<InkStroke, Path2D>()

/** The path a stroke paints as, in plane coordinates. */
function pathOf(stroke: InkStroke, finished = true): Path2D {
  const held = finished ? paths.get(stroke) : undefined
  if (held) return held

  const path = new Path2D()
  traceInk(outlineOf(stroke, finished), path)

  if (finished) paths.set(stroke, path)
  return path
}

/** A speckled fill, one per colour, so a pencil leaves a grain rather than a
 *  solid body. Built once at a fixed size and repeated: a pattern is one fill
 *  however long the stroke is. */
const grains = new Map<string, CanvasPattern | null>()

const GRAIN = 64

function grainOf(ctx: CanvasRenderingContext2D, colour: string): CanvasPattern | null {
  const held = grains.get(colour)
  if (held !== undefined) return held

  const tile = document.createElement('canvas')
  tile.width = GRAIN
  tile.height = GRAIN
  const paint = tile.getContext('2d')

  if (!paint) {
    grains.set(colour, null)
    return null
  }

  paint.fillStyle = colour
  // A field of dots at uneven weights, which is what graphite on paper is: the
  // tooth of the paper takes the lead in some places and not in others. Dense
  // enough to read as a line rather than as a dotted one, and never solid.
  for (let one = 0; one < GRAIN * GRAIN * 0.62; one++) {
    paint.globalAlpha = 0.35 + Math.random() * 0.65
    paint.fillRect(Math.random() * GRAIN, Math.random() * GRAIN, 1, 1)
  }

  const pattern = ctx.createPattern(tile, 'repeat')
  grains.set(colour, pattern)
  return pattern
}

/** What a canvas colour is on screen. The six presets are tokens, so the theme
 *  says what they are; anything else is a colour already. */
export type Palette = Record<string, string>

/** What a stroke's colour is on screen and in a picture: the theme's answer for a
 *  name the palette holds, and the colour itself for anything else.
 *
 *  Asked of the palette's own keys and never of what every object inherits, so a
 *  file that wrote `"toString"` where a colour goes is a colour nothing can draw
 *  rather than a function turned into a string. */
export function inkColour(colour: string, palette: Palette): string {
  return Object.hasOwn(palette, colour) ? (palette[colour] ?? colour) : colour
}

export interface View {
  camera: Camera
  width: number
  height: number
  /** Device pixels per CSS pixel. */
  ratio: number
}

/** Puts the plane's coordinates on the context, so everything drawn after is
 *  drawn in the units the file is written in. */
function place(ctx: CanvasRenderingContext2D, view: View) {
  const { camera, width, height, ratio } = view
  ctx.setTransform(
    camera.scale * ratio,
    0,
    0,
    camera.scale * ratio,
    (width / 2 - camera.x * camera.scale) * ratio,
    (height / 2 - camera.y * camera.scale) * ratio,
  )
}

/** The part of the plane on screen, in plane units, with a little room to spare
 *  so a stroke half off the edge is still drawn. */
function seen(view: View, slack = 0): Box {
  const { camera, width, height } = view
  return {
    x: camera.x - width / 2 / camera.scale - slack,
    y: camera.y - height / 2 / camera.scale - slack,
    width: width / camera.scale + 2 * slack,
    height: height / camera.scale + 2 * slack,
  }
}

function meets(box: Box, view: Box): boolean {
  return (
    box.x < view.x + view.width &&
    view.x < box.x + box.width &&
    box.y < view.y + view.height &&
    view.y < box.y + box.height
  )
}

/** The context set to draw in one kind of ink: how translucent it is, how it
 *  sits on what is under it, and whether it has a grain. */
function inkStyle(ctx: CanvasRenderingContext2D, stroke: InkStroke, palette: Palette) {
  const style = INK_STYLES[stroke.tool]
  const colour = inkColour(stroke.color, palette)

  ctx.globalAlpha = inkOpacity(stroke)
  ctx.globalCompositeOperation = style.multiply ? 'multiply' : 'source-over'

  if (style.grain) {
    const grain = grainOf(ctx, colour)
    // The pattern is in device pixels, so it is pinned to the plane rather than
    // to the screen: a grain that swam about while panning would read as fog.
    ctx.fillStyle = grain ?? colour
  } else {
    ctx.fillStyle = colour
  }
}

/** A layer wiped back to nothing.
 *
 *  Said out loud rather than left to whatever the layer was made with, and from
 *  a known state, because the ink before it may have been laid down through a
 *  blend. On a backing that kept no alpha this would leave opaque black instead
 *  of nothing, which is the trouble `backing.ts` goes to in order never to hand
 *  one over. */
function wipe(ctx: CanvasRenderingContext2D, view: View) {
  const { width, height, ratio } = view
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width * ratio, height * ratio)
}

/** A box grown by `slack` on every side. */
function grown(box: Box, slack: number): Box {
  return {
    x: box.x - slack,
    y: box.y - slack,
    width: box.width + 2 * slack,
    height: box.height + 2 * slack,
  }
}

function inside(box: Box, outer: Box): boolean {
  return (
    box.x >= outer.x &&
    box.y >= outer.y &&
    box.x + box.width <= outer.x + outer.width &&
    box.y + box.height <= outer.y + outer.height
  )
}

interface Batch {
  stroke: InkStroke
  path: Path2D
}

interface Gathered {
  strokes: readonly InkStroke[]
  covers: Box
  batches: Map<string, Batch>
  drawn: number
}

/** The batches gathered for a plane, and the part of it they cover.
 *
 *  Kept because gathering them is the expensive half of a repaint and the camera
 *  moving does not change them: the paths are in plane coordinates, so a pan is a
 *  transform and the shapes are the shapes. See `paintInk`.
 *
 *  Weak, and keyed on the list of strokes itself, so nothing here outlives the
 *  plane it is about: a canvas closed takes its geometry with it, which a slot
 *  holding the last plane painted would not have. Two panes each showing a canvas
 *  get one entry each rather than taking turns emptying a single slot. */
const gathered = new WeakMap<readonly InkStroke[], Gathered>()

/** The list painted last, weakly, which is the only thing a plane with a stroke
 *  added on the end can be recognised by: the new list is a key nothing has seen.
 *  Weak for the reason above - a plane nobody is looking at is nobody's. */
let painted: WeakRef<readonly InkStroke[]> | null = null

let batched = 0

/** How many strokes have been put into a batch path, ever - a running total, read
 *  as a difference either side of whatever is being asked about.
 *
 *  Counted rather than timed, for the reason fuzzy.ts gives beside its own
 *  counters: a clock says what the machine was doing and a count says what the
 *  code did. That a pan over a plane of ten thousand strokes adds up to no strokes
 *  at all after the first frame is the whole of the paragraph in `paintInk`, and it
 *  is asserted in paint.test.ts. */
export function strokesBatched(): number {
  return batched
}

/** How much of the plane either side of the view is gathered, as a share of the
 *  view's own size. One viewport of margin all round, which is the pan a hand
 *  makes in a second or so: far enough that a drag is one gather rather than one
 *  per frame, near enough that the paths hold the part of a plane somebody is
 *  looking at rather than all of it. */
const SPARE = 1

/** Some of a list of strokes into the batches, from `at` onwards. Answers how
 *  many went in. */
function gather(
  batches: Map<string, Batch>,
  strokes: readonly InkStroke[],
  covers: Box,
  at: number,
): number {
  let drawn = 0

  for (let one = at; one < strokes.length; one++) {
    const stroke = strokes[one]
    if (!stroke || !meets(strokeBox(stroke), covers)) continue

    // Ink that is set the same way is one shape to fill. The alpha is part of
    // being set the same way: two strokes at different opacities cannot share a
    // fill without one of them coming out at the other's.
    const key = `${stroke.tool}
${stroke.color}
${inkOpacity(stroke)}`
    const batch = batches.get(key)

    if (batch) batch.path.addPath(pathOf(stroke))
    else {
      const path = new Path2D()
      path.addPath(pathOf(stroke))
      batches.set(key, { stroke, path })
    }

    drawn++
  }

  batched += drawn
  return drawn
}

/** Whether `now` is `was` with something added on the end - the same strokes, by
 *  identity, and then more. Which is what drawing one is, and what a room
 *  delivering one is.
 *
 *  A walk of references, which is nothing beside the copies of a hundred thousand
 *  points that gathering the whole plane again would make. */
function grewFrom(was: readonly InkStroke[], now: readonly InkStroke[]): boolean {
  if (now.length <= was.length) return false
  for (let one = 0; one < was.length; one++) if (was[one] !== now[one]) return false

  return true
}

/** Every stroke in view, in as few fills as there are kinds of ink on it.
 *
 *  Strokes drawn in the same tool and the same colour are one shape as far as
 *  the paint is concerned, so they go into one path and are filled once. A page
 *  of five thousand strokes is then forty fills rather than five thousand, and
 *  the state changes between them - the alpha, the blend, the grain - happen
 *  forty times rather than five thousand. That is the difference between a
 *  quarter of a second and a frame.
 *
 *  It changes one thing, and for the better: two passes of a highlighter over
 *  one word are now one shape and darken once, which is what a highlighter does
 *  on paper.
 *
 *  The batches themselves are kept between repaints, because putting them
 *  together is what a repaint mostly costs and the camera has nothing to do with
 *  them: `addPath` copies a stroke's outline into the batch, so a plane of ten
 *  thousand strokes copied a hundred thousand points of geometry per frame while
 *  it was being panned - a hundred milliseconds a frame, which is twelve frames a
 *  second on a plane a reader is dragging with their hand. The paths are in plane
 *  coordinates, so what they are does not depend on where the camera is; only
 *  *which* of them are gathered does. So they are gathered for a viewport of plane
 *  either side of the view and kept until the camera leaves that, and a pan is the
 *  fills and nothing else.
 *
 *  Answers how many strokes were painted, which is what the measurement reads. */
export function paintInk(
  ctx: CanvasRenderingContext2D,
  strokes: readonly InkStroke[],
  view: View,
  palette: Palette,
  picked?: ReadonlySet<string>,
): number {
  wipe(ctx, view)
  place(ctx, view)

  const box = seen(view)
  const near = (one: Gathered | undefined) => (one && inside(box, one.covers) ? one : null)

  // The same plane with a stroke added on the end: what was gathered still stands,
  // and only the new one goes into it. Without this, drawing a stroke on a plane of
  // ten thousand gathered all ten thousand again, which is the hundred
  // milliseconds the pen lifted for.
  let held = near(gathered.get(strokes))
  if (!held) {
    const was = painted?.deref()
    const grew = was && grewFrom(was, strokes) ? near(gathered.get(was)) : null

    if (grew) {
      grew.drawn += gather(grew.batches, strokes, grew.covers, grew.strokes.length)
      grew.strokes = strokes
      held = grew
    }
  }

  if (!held) {
    // A viewport of plane either side of the view, so panning stays inside what
    // was gathered rather than leaving it on the next frame.
    const covers = grown(box, SPARE * Math.max(box.width, box.height))
    const batches = new Map<string, Batch>()
    held = { strokes, covers, batches, drawn: gather(batches, strokes, covers, 0) }
  }

  gathered.set(strokes, held)
  painted = new WeakRef(strokes)

  for (const batch of held.batches.values()) {
    inkStyle(ctx, batch.stroke, palette)
    ctx.fill(batch.path, 'nonzero')
  }

  if (picked?.size) {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    for (const stroke of strokes) {
      if (!picked.has(stroke.id) || !meets(strokeBox(stroke), box)) continue

      // A picked stroke wears the accent as a halo rather than a new colour, so
      // it is still the colour it was written in.
      ctx.strokeStyle = palette.accent ?? '#4c6ef5'
      ctx.lineWidth = 1.5 / view.camera.scale
      ctx.stroke(pathOf(stroke))
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return held.drawn
}

/** The one stroke under the pen, on its own layer. Cleared and redrawn on every
 *  event, which is cheap because it is one stroke. */
export function paintLive(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke | null,
  view: View,
  palette: Palette,
) {
  wipe(ctx, view)
  if (!stroke) return

  place(ctx, view)
  inkStyle(ctx, stroke, palette)
  ctx.fill(pathOf(stroke, false), 'nonzero')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}
