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
import { INK_STYLES, outlineOf, strokeBox } from './ink'

/** Outlines already worked out. Weak, so a stroke that has been erased takes its
 *  path with it without anybody sweeping up. */
const paths = new WeakMap<InkStroke, Path2D>()

/** The path a stroke paints as, in plane coordinates. */
function pathOf(stroke: InkStroke, finished = true): Path2D {
  const held = finished ? paths.get(stroke) : undefined
  if (held) return held

  const path = new Path2D()
  const ring = outlineOf(stroke, finished)
  const [first] = ring

  if (first) {
    path.moveTo(first.x, first.y)
    for (let one = 1; one < ring.length; one++) {
      const point = ring[one]
      if (point) path.lineTo(point.x, point.y)
    }
    path.closePath()
  }

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

function inkColour(colour: string, palette: Palette): string {
  return palette[colour] ?? colour
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

  ctx.globalAlpha = style.opacity
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
 *  Answers how many strokes were painted, which is what the measurement reads. */
export function paintInk(
  ctx: CanvasRenderingContext2D,
  strokes: readonly InkStroke[],
  view: View,
  palette: Palette,
  picked?: ReadonlySet<string>,
): number {
  const { width, height, ratio } = view
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * ratio, height * ratio)
  place(ctx, view)

  const box = seen(view)

  const batches = new Map<string, { stroke: InkStroke; path: Path2D }>()
  let drawn = 0

  for (const stroke of strokes) {
    if (!meets(strokeBox(stroke), box)) continue

    const key = `${stroke.tool}
${stroke.color}`
    const held = batches.get(key)

    if (held) held.path.addPath(pathOf(stroke))
    else {
      const path = new Path2D()
      path.addPath(pathOf(stroke))
      batches.set(key, { stroke, path })
    }

    drawn++
  }

  for (const batch of batches.values()) {
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
  return drawn
}

/** The one stroke under the pen, on its own layer. Cleared and redrawn on every
 *  event, which is cheap because it is one stroke. */
export function paintLive(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke | null,
  view: View,
  palette: Palette,
) {
  const { width, height, ratio } = view
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * ratio, height * ratio)
  if (!stroke) return

  place(ctx, view)
  inkStyle(ctx, stroke, palette)
  ctx.fill(pathOf(stroke, false), 'nonzero')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

/** A 2d context asked to keep up with the pen rather than with the page.
 *
 *  `desynchronized` is a hint and nothing more: the browser may ignore it, and
 *  on Android it bypasses the compositor queue rather than drawing to the front
 *  buffer. Asked for anyway, because where it is honoured it is the difference
 *  between ink under the nib and ink a frame behind it. */
export function inkContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { desynchronized: true, alpha: true })
}
