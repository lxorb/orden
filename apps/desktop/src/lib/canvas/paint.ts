import type { Camera } from '../camera'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { INK_STYLES, inkOpacity, outlineOf, strokeBox, traceInk } from './ink'

export type Paintable = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const paths = new WeakMap<InkStroke, Path2D>()

export function pathOf(stroke: InkStroke, finished = true): Path2D {
  const held = finished ? paths.get(stroke) : undefined
  if (held) return held

  const path = new Path2D()
  traceInk(outlineOf(stroke, finished), path)

  if (finished) paths.set(stroke, path)
  return path
}

export function outlined(stroke: InkStroke): boolean {
  return paths.has(stroke)
}

const grains = new Map<string, CanvasPattern | null>()

const GRAIN = 64

function grainOf(ctx: Paintable, colour: string): CanvasPattern | null {
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
  for (let one = 0; one < GRAIN * GRAIN * 0.62; one++) {
    paint.globalAlpha = 0.35 + Math.random() * 0.65
    paint.fillRect(Math.random() * GRAIN, Math.random() * GRAIN, 1, 1)
  }

  const pattern = ctx.createPattern(tile, 'repeat')
  grains.set(colour, pattern)
  return pattern
}

export type Palette = Record<string, string>

export function inkColour(colour: string, palette: Palette): string {
  return Object.hasOwn(palette, colour) ? (palette[colour] ?? colour) : colour
}

export interface View {
  camera: Camera
  width: number
  height: number
  ratio: number
}

export function origin(view: View): { x: number; y: number } {
  const { camera, width, height, ratio } = view
  return {
    x: Math.round((width / 2 - camera.x * camera.scale) * ratio),
    y: Math.round((height / 2 - camera.y * camera.scale) * ratio),
  }
}

function place(ctx: Paintable, view: View) {
  const scale = view.camera.scale * view.ratio
  const at = origin(view)
  ctx.setTransform(scale, 0, 0, scale, at.x, at.y)
}

export function seen(view: View): Box {
  const { camera, width, height } = view
  return {
    x: camera.x - width / 2 / camera.scale,
    y: camera.y - height / 2 / camera.scale,
    width: width / camera.scale,
    height: height / camera.scale,
  }
}

function meets(box: Box, other: Box): boolean {
  return (
    box.x < other.x + other.width &&
    other.x < box.x + box.width &&
    box.y < other.y + other.height &&
    other.y < box.y + box.height
  )
}

function inkStyle(ctx: Paintable, stroke: InkStroke, palette: Palette) {
  const style = INK_STYLES[stroke.tool]
  const colour = inkColour(stroke.color, palette)

  ctx.globalAlpha = inkOpacity(stroke)
  ctx.globalCompositeOperation = style.multiply ? 'multiply' : 'source-over'

  if (style.grain) {
    const grain = grainOf(ctx, colour)
    ctx.fillStyle = grain ?? colour
  } else {
    ctx.fillStyle = colour
  }
}

export function plain(ctx: Paintable) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

export function wipe(ctx: Paintable, width: number, height: number) {
  plain(ctx)
  ctx.clearRect(0, 0, width, height)
}

const kinds = new WeakMap<InkStroke, string>()

export function inkKind(stroke: InkStroke): string {
  const held = kinds.get(stroke)
  if (held !== undefined) return held

  const kind = `${stroke.tool}
${stroke.color}
${inkOpacity(stroke)}`
  kinds.set(stroke, kind)
  return kind
}

let filled = 0

export function strokesFilled(): number {
  return filled
}

export function fillInk(
  ctx: Paintable,
  strokes: Iterable<InkStroke>,
  palette: Palette,
  rank: (kind: string) => number,
) {
  const batches = new Map<string, { stroke: InkStroke; path: Path2D }>()

  for (const stroke of strokes) {
    const kind = inkKind(stroke)
    const batch = batches.get(kind)

    if (batch) batch.path.addPath(pathOf(stroke))
    else {
      const path = new Path2D()
      path.addPath(pathOf(stroke))
      batches.set(kind, { stroke, path })
    }

    filled++
  }

  const order = [...batches].sort(([one], [other]) => rank(one) - rank(other))
  for (const [, batch] of order) {
    inkStyle(ctx, batch.stroke, palette)
    ctx.fill(batch.path, 'nonzero')
  }
}

function sketch(path: Path2D, stroke: InkStroke, step: number) {
  const [first] = stroke.points
  if (!first) return

  path.moveTo(first.x, first.y)
  let last = first
  for (const point of stroke.points) {
    if (Math.abs(point.x - last.x) + Math.abs(point.y - last.y) < step) continue
    path.lineTo(point.x, point.y)
    last = point
  }

  const end = stroke.points[stroke.points.length - 1] ?? first
  if (last === first) path.lineTo(first.x + step / 4, first.y)
  else if (last !== end) path.lineTo(end.x, end.y)
}

export function paintSketch(
  ctx: Paintable,
  strokes: readonly InkStroke[],
  view: View,
  palette: Palette,
) {
  wipe(ctx, view.width * view.ratio, view.height * view.ratio)
  place(ctx, view)

  const step = 1 / (view.camera.scale * view.ratio)
  const box = seen(view)
  const order = firstSeen(strokes)
  const batches = new Map<string, { stroke: InkStroke; path: Path2D }>()

  for (const stroke of strokes) {
    if (!meets(strokeBox(stroke), box)) continue
    const kind = `${inkKind(stroke)}\n${stroke.size}`
    let batch = batches.get(kind)
    if (!batch) {
      batch = { stroke, path: new Path2D() }
      batches.set(kind, batch)
    }
    sketch(batch.path, stroke, step)
  }

  const rank = (stroke: InkStroke) => order.get(inkKind(stroke)) ?? order.size
  const ranked = [...batches.values()].sort((one, other) => rank(one.stroke) - rank(other.stroke))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const { stroke, path } of ranked) {
    inkStyle(ctx, stroke, palette)
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = stroke.size
    ctx.stroke(path)
  }

  plain(ctx)
}

export function firstSeen(strokes: readonly InkStroke[]): Map<string, number> {
  const order = new Map<string, number>()
  for (const stroke of strokes) {
    const kind = inkKind(stroke)
    if (!order.has(kind)) order.set(kind, order.size)
  }

  return order
}

export function paintPicked(
  ctx: Paintable,
  strokes: readonly InkStroke[],
  picked: ReadonlySet<string>,
  view: View,
  palette: Palette,
) {
  if (!picked.size) return

  const box = seen(view)
  place(ctx, view)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = palette.accent ?? '#4c6ef5'
  ctx.lineWidth = 1.5 / view.camera.scale

  for (const stroke of strokes) {
    if (picked.has(stroke.id) && meets(strokeBox(stroke), box)) ctx.stroke(pathOf(stroke))
  }

  plain(ctx)
}

export function paintLive(ctx: Paintable, stroke: InkStroke | null, view: View, palette: Palette) {
  wipe(ctx, view.width * view.ratio, view.height * view.ratio)
  if (!stroke) return

  place(ctx, view)
  inkStyle(ctx, stroke, palette)
  ctx.fill(pathOf(stroke, false), 'nonzero')
  plain(ctx)
}
