const OPAQUE = 128
const LEAST = 0.02
const NEAR = 48
const FAR = 120
const TILE = 0.5
const FILLED = 0.7
type Colour = [number, number, number]
function colourAt(rgba: Uint8ClampedArray, at: number): Colour {
  return [rgba[at * 4] ?? 0, rgba[at * 4 + 1] ?? 0, rgba[at * 4 + 2] ?? 0]
}
function commonest(rgba: Uint8ClampedArray, among: readonly number[]): { colour: Colour; share: number } {
  const counts = new Map<number, [number, number, number, number]>()
  let best: [number, number, number, number] = [0, 0, 0, 0]
  for (const at of among) {
    const [r, g, b] = colourAt(rgba, at)
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const held = counts.get(key) ?? [0, 0, 0, 0]
    held[0] += r
    held[1] += g
    held[2] += b
    held[3] += 1
    counts.set(key, held)
    if (held[3] > best[3]) best = held
  }
  const many = best[3] || 1
  return { colour: [best[0] / many, best[1] / many, best[2] / many], share: best[3] / (among.length || 1) }
}
function apart(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, from: Colour): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length)
  for (let at = 0; at < alpha.length; at++) {
    const [r, g, b] = colourAt(rgba, at)
    const far = Math.hypot(r - from[0], g - from[1], b - from[2])
    out[at] = Math.round(Math.min(1, Math.max(0, (far - NEAR) / (FAR - NEAR))) * (alpha[at] ?? 0))
  }
  return out
}
function covered(alpha: Uint8ClampedArray): number {
  let on = 0
  for (const one of alpha) on += one / 255
  return on / (alpha.length || 1)
}
export function silhouette(rgba: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const pixels = size * size
  const alpha = new Uint8ClampedArray(pixels)
  const opaque: number[] = []
  const border: number[] = []
  let [left, top, right, bottom] = [size, size, -1, -1]
  for (let at = 0; at < pixels; at++) {
    alpha[at] = rgba[at * 4 + 3] ?? 0
    const [x, y] = [at % size, Math.floor(at / size)]
    const solid = (alpha[at] ?? 0) >= OPAQUE
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) border.push(at)
    if (!solid) continue
    opaque.push(at)
    ;[left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)]
  }
  if (!opaque.length) return alpha
  const edged = border.filter((at) => (alpha[at] ?? 0) >= OPAQUE)
  let marked: Uint8ClampedArray | null = null
  if (edged.length > border.length / 2) marked = apart(rgba, alpha, commonest(rgba, edged).colour)
  else {
    const fill = opaque.length / ((right - left + 1) * (bottom - top + 1))
    const inside = commonest(rgba, opaque)
    if (fill >= FILLED && inside.share >= TILE) marked = apart(rgba, alpha, inside.colour)
  }
  return marked && covered(marked) >= LEAST ? marked : alpha
}
