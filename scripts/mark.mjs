/* The Orden mark, once, for every script that draws it: four bars locking into a
   square O, on a tile washed in the Glass default (light blue top left, soft pink
   bottom right, the same two colours the theme opens on).

   Everything here is a function of a point on a 1024 grid, so any size is drawn
   straight from the shapes rather than scaled from a bitmap: the 16 px clipper
   icon is as sharp as the 1024 master. Dependency-free so the repo stays clean. */

import { deflateSync } from 'node:zlib'

export const GRID = 1024

/** The Glass default pair (packages/themes, light scheme) and the ink on it. */
export const SKY = [0xbf, 0xdd, 0xfb]
export const BLUSH = [0xe7, 0xc6, 0xec]
export const INK = [0x1c, 0x22, 0x33]

/** The bars on a tile that fills the grid: 136 thick, 22 apart, a 528 square,
   each bar running on into the next corner so the four turn like a lock. */
const T = 136
const GAP = 22
const A = 248
const B = 776
const M = B - T
const R = 34
const BARS = [
  [A, A, M - GAP, A + T],
  [M, A, B, M - GAP],
  [A + T + GAP, M, B, B],
  [A, A + T + GAP, A + T, B],
]

function inRoundedRect(x, y, [x0, y0, x1, y1]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + R), x1 - R)
  const cy = Math.min(Math.max(y, y0 + R), y1 - R)
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R
}

/** Whether a point of a tile `size` wide, centred on the grid, falls on a bar. */
export function onBars(x, y, size = GRID) {
  const k = GRID / size
  const gx = GRID / 2 + (x - GRID / 2) * k
  const gy = GRID / 2 + (y - GRID / 2) * k
  return BARS.some((bar) => inRoundedRect(gx, gy, bar))
}

/** Apple's continuous-corner tile, near enough: a superellipse of degree five. */
export function inSquircle(x, y, size = GRID) {
  const a = size / 2
  const dx = Math.abs(x - GRID / 2) / a
  const dy = Math.abs(y - GRID / 2) / a
  return dx ** 5 + dy ** 5 <= 1
}

const mix = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t)

/** The wash: a diagonal blend with a faint glow of each colour in its own corner,
   measured on the tile so a smaller tile carries the same picture. */
export function wash(x, y, size = GRID) {
  const o = (GRID - size) / 2
  const u = (x - o) / size
  const v = (y - o) / size
  let colour = mix(SKY, BLUSH, Math.min(Math.max((u + v) / 2, 0), 1))
  const glow = (cu, cv, c) => {
    const d = Math.hypot(u - cu, v - cv) / 0.6
    if (d < 1) colour = mix(colour, c, 0.55 * (1 - d))
  }
  glow(0.16, 0.16, SKY)
  glow(0.84, 0.84, BLUSH)
  return colour
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encode(size, channels, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 4
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const SS = 4

/** Draws `at(x, y)` (a colour on the 1024 grid, or null for nothing) into a
   square PNG `size` wide, supersampled four by four. `grey` writes grey plus
   alpha and expects `at` to return one number. */
export function png(size, at, { grey = false } = {}) {
  const channels = grey ? 2 : 4
  const raw = Buffer.alloc(size * (size * channels + 1))
  let cursor = 0
  for (let y = 0; y < size; y++) {
    raw[cursor++] = 0
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0]
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const found = at(
            ((x + (sx + 0.5) / SS) / size) * GRID,
            ((y + (sy + 0.5) / SS) / size) * GRID,
          )
          if (found === null) continue
          const c = grey ? [found, 0, 0] : found
          sum[0] += c[0]
          sum[1] += c[1]
          sum[2] += c[2]
          hits++
        }
      }
      const alpha = (hits / (SS * SS)) * 255
      const take = (v) => (hits ? Math.round(v / hits) : 0)
      if (grey) raw[cursor++] = take(sum[0])
      else for (const v of sum) raw[cursor++] = take(v)
      raw[cursor++] = Math.round(alpha)
    }
  }
  return encode(size, channels, raw)
}
