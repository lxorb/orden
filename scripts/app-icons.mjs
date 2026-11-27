import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRID, INK, inSquircle, png, wash } from './mark.mjs'

export const T = 136
export const GAP = 22
export const R = 34
export const WIDE = 528
const ROWS_APART = 78
const STEP = T + GAP
const SEEN = (GRID * 72) / 108
export const SAFE = (GRID * 33) / 108
export const SCALE = (0.6 * SEEN) / WIDE
export const APPS = {
  notes: {
    bars: [
      [0, 0, WIDE - STEP, T],
      [WIDE - T, 0, WIDE, WIDE - STEP],
      [STEP, WIDE - T, WIDE, WIDE],
      [0, STEP, T, WIDE],
    ],
    ground: null,
  },
  todo: {
    bars: [
      [0, 0, 334, T],
      [334 + GAP, 0, WIDE, T],
      [0, T + ROWS_APART, 172, 2 * T + ROWS_APART],
      [172 + GAP, T + ROWS_APART, WIDE, 2 * T + ROWS_APART],
    ],
    ground: ['#fbf9bc', '#fabaa8'],
  },
  chat: {
    bars: [
      [0, 0, WIDE - STEP, T],
      [WIDE - T, 0, WIDE, 2 * T],
      [STEP, 2 * T + GAP, WIDE, 3 * T + GAP],
      [0, STEP, T, STEP + 424],
    ],
    ground: ['#c9efbe', '#b8c5fa'],
  },
  track: {
    bars: [
      [0, 0, T, 2 * T + GAP],
      [STEP, 0, WIDE, T],
      [STEP, STEP, WIDE - T, STEP + T],
      [0, 2 * STEP, WIDE - 2 * T, 2 * STEP + T],
    ],
    ground: ['#fdd9c4', '#e1b1ed'],
  },
}
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
export function placed(bars) {
  const right = bars.reduce((most, bar) => Math.max(most, bar[2]), 0)
  const bottom = bars.reduce((most, bar) => Math.max(most, bar[3]), 0)
  let area = 0
  let wx = 0
  let wy = 0
  for (const [x0, y0, x1, y1] of bars) {
    const one = (x1 - x0) * (y1 - y0)
    area += one
    wx += ((x0 + x1) / 2) * one
    wy += ((y0 + y1) / 2) * one
  }
  const cx = right / 2 + (wx / area - right / 2) / 4
  const cy = bottom / 2 + (wy / area - bottom / 2) / 4
  return bars.map(([x0, y0, x1, y1]) => [
    GRID / 2 + (x0 - cx) * SCALE,
    GRID / 2 + (y0 - cy) * SCALE,
    GRID / 2 + (x1 - cx) * SCALE,
    GRID / 2 + (y1 - cy) * SCALE,
  ])
}
function onBar(x, y, [x0, y0, x1, y1]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const r = R * SCALE
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function painter(app) {
  const bars = placed(APPS[app].bars)
  const ends = APPS[app].ground
  const edge = (GRID - SEEN) / 2
  const blend = (x, y) => {
    const [from, to] = ends.map(rgb)
    const along = Math.min(Math.max(((x - edge) / SEEN + (y - edge) / SEEN) / 2, 0), 1)
    return from.map((value, at) => value + (to[at] - value) * along)
  }
  const ground = ends ? blend : (x, y) => wash(x, y, SEEN)
  const inked = (x, y) => bars.some((bar) => onBar(x, y, bar))
  return { ground, inked }
}
export function layers(app, density) {
  const { ground, inked } = painter(app)
  const layer = Math.round(108 * DENSITIES[density])
  const old = Math.round(48 * DENSITIES[density])
  const within = (shape, size) => (x, y) => {
    if (!shape(x, y, size)) return null
    const sx = GRID / 2 + ((x - GRID / 2) * SEEN) / size
    const sy = GRID / 2 + ((y - GRID / 2) * SEEN) / size
    return inked(sx, sy) ? INK : ground(sx, sy)
  }
  const disc = (x, y, size) => Math.hypot(x - GRID / 2, y - GRID / 2) <= size / 2
  return {
    'ic_launcher_background.png': png(layer, ground),
    'ic_launcher_foreground.png': png(layer, (x, y) => (inked(x, y) ? INK : null)),
    'ic_launcher_monochrome.png': png(layer, (x, y) => (inked(x, y) ? [255, 255, 255] : null)),
    'ic_launcher.png': png(old, within(inSquircle, GRID * 0.84)),
    'ic_launcher_round.png': png(old, within(disc, GRID * 0.92)),
  }
}
export const densities = Object.keys(DENSITIES)
export const resOf = (root, app) => join(root, 'apps/desktop/src-tauri/gen/android/app/src', app, 'res')
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  for (const app of Object.keys(APPS)) {
    for (const density of densities) {
      const dir = join(resOf(root, app), `mipmap-${density}`)
      mkdirSync(dir, { recursive: true })
      for (const [name, bytes] of Object.entries(layers(app, density))) writeFileSync(join(dir, name), bytes)
    }
  }
  console.log('the launcher icons of Orden Notes, Todo, Chat and Track')
}
