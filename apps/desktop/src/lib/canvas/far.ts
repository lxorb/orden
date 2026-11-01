/** The painting of the plane from far away; see CanvasFar.svelte (#535). */

import type { CanvasEdge, CanvasNode } from './format'
import { type Box, boxOf, edgeEnds, overlaps } from './geometry'
import type { Palette } from './paint'

export interface FarScene {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  picked: ReadonlySet<string>
  dimmed: boolean
  skip: string | null
  view: Box
  scale: number
  originX: number
  originY: number
  width: number
  height: number
  palette: Palette
  /** Device pixels to a CSS pixel. */
  ratio: number
}

/** Every card in view a box and every connector a line, onto `canvas`. */
export function paintFar(canvas: HTMLCanvasElement, scene: FarScene): void {
  const { nodes, edges, picked, dimmed, skip, view, scale, originX, originY, palette, ratio } =
    scene
  const context = canvas.getContext('2d')
  if (!context) return
  /** A card's colour as the theme draws it: one of the six by name, or its own. */
  const tint = (colour: string | undefined): string | null =>
    colour === undefined ? null : (palette[colour] ?? colour)
  const wide = Math.max(1, Math.round(scene.width * ratio))
  const tall = Math.max(1, Math.round(scene.height * ratio))
  if (canvas.width !== wide) canvas.width = wide
  if (canvas.height !== tall) canvas.height = tall

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, wide, tall)
  const k = scale * ratio
  context.setTransform(k, 0, 0, k, originX * ratio, originY * ratio)
  // One screen pixel, in plane units.
  const pixel = 1 / scale

  const surface = palette.surface ?? '#ffffff'
  const line = palette.line ?? '#d6d9de'
  const accent = palette.accent ?? '#4c6ef5'
  const muted = palette.muted ?? '#8a9099'

  const byId = new Map<string, Box>()
  for (const node of nodes) byId.set(node.id, boxOf(node))

  // The connectors under the cards, as the plane stacks them.
  context.lineCap = 'round'
  for (const edge of edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue
    if (!overlaps(from, view) && !overlaps(to, view)) continue
    const ends = edgeEnds(edge, from, to)
    const chosen = picked.has(edge.id)
    context.globalAlpha = dimmed && !chosen ? 0.25 : 1
    context.strokeStyle = chosen ? accent : (tint(edge.color) ?? muted)
    context.lineWidth = (chosen ? 2 : 1) * pixel
    context.beginPath()
    context.moveTo(ends.from.x, ends.from.y)
    context.lineTo(ends.to.x, ends.to.y)
    context.stroke()
  }

  for (const node of nodes) {
    if (node.id === skip) continue
    const box = byId.get(node.id)
    if (!box || !overlaps(box, view)) continue
    const chosen = picked.has(node.id)
    const colour = tint(node.color)
    context.globalAlpha = dimmed && !chosen ? 0.25 : 1

    if (node.type === 'group') {
      // A frame: its outline, and the faintest wash of its colour.
      if (colour) {
        context.globalAlpha *= 0.06
        context.fillStyle = colour
        context.fillRect(box.x, box.y, box.width, box.height)
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
    } else {
      context.fillStyle = surface
      context.fillRect(box.x, box.y, box.width, box.height)
      if (colour) {
        // A coloured card wears a breath of its colour, as near (CanvasNode.svelte).
        context.globalAlpha *= 0.09
        context.fillStyle = colour
        context.fillRect(box.x, box.y, box.width, box.height)
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
      // Where there are words, a bar or two where they would be, while a card is
      // tall enough on screen to hold them.
      if (node.type === 'text' && node.text.trim() && box.height * scale >= 8) {
        context.fillStyle = muted
        context.globalAlpha *= 0.35
        const inset = Math.min(box.width, box.height) * 0.15
        const bar = Math.max(pixel, box.height * 0.12)
        context.fillRect(box.x + inset, box.y + inset, (box.width - 2 * inset) * 0.7, bar)
        if (box.height * scale >= 16) {
          context.fillRect(
            box.x + inset,
            box.y + inset + 2 * bar,
            (box.width - 2 * inset) * 0.45,
            bar,
          )
        }
        context.globalAlpha = dimmed && !chosen ? 0.25 : 1
      }
    }
    context.strokeStyle = chosen ? accent : (colour ?? line)
    context.lineWidth = (chosen ? 2 : 1) * pixel
    context.strokeRect(box.x, box.y, box.width, box.height)
  }
  context.globalAlpha = 1
}
