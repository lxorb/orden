/* Draws the Nib mark to a PNG. Run once, then `pnpm tauri icon` fans it out.
   Dependency-free so the repo stays clean. */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SIZE = 1024
const SS = 4 // supersample factor
const ACCENT = [124, 107, 245]
const INK = [255, 255, 255]

const corner = 224
const tip = [512, 812]
const left = [296, 236]
const right = [728, 236]
const hole = { x: 512, y: 430, r: 54 }
const slit = 13

function inRoundedSquare(x, y) {
  const inset = 0
  const min = inset
  const max = SIZE - inset
  const cx = Math.min(Math.max(x, min + corner), max - corner)
  const cy = Math.min(Math.max(y, min + corner), max - corner)
  return (
    (x - cx) ** 2 + (y - cy) ** 2 <= corner ** 2 ||
    (x >= min &&
      x <= max &&
      y >= min &&
      y <= max &&
      (Math.abs(x - cx) < corner || Math.abs(y - cy) < corner))
  )
}

function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
}

function inTriangle(x, y) {
  const d1 = sign(x, y, left[0], left[1], right[0], right[1])
  const d2 = sign(x, y, right[0], right[1], tip[0], tip[1])
  const d3 = sign(x, y, tip[0], tip[1], left[0], left[1])
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

function inHole(x, y) {
  return (x - hole.x) ** 2 + (y - hole.y) ** 2 <= hole.r ** 2
}

function inSlit(x, y) {
  return Math.abs(x - hole.x) <= slit && y >= hole.y && y <= tip[1]
}

function sample(x, y) {
  if (!inRoundedSquare(x, y)) return null
  if (inTriangle(x, y) && !inHole(x, y) && !inSlit(x, y)) return INK
  return ACCENT
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let cursor = 0

for (let y = 0; y < SIZE; y++) {
  raw[cursor++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0

    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        if (px) {
          r += px[0]
          g += px[1]
          b += px[2]
          a += 255
        }
      }
    }

    const n = SS * SS
    const alpha = a / n
    raw[cursor++] = alpha ? Math.round(r / n / (alpha / 255)) : 0
    raw[cursor++] = alpha ? Math.round(g / n / (alpha / 255)) : 0
    raw[cursor++] = alpha ? Math.round(b / n / (alpha / 255)) : 0
    raw[cursor++] = Math.round(alpha)
  }
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

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] ?? 'apps/desktop/src-tauri/icon-source.png'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`${out} ${SIZE}x${SIZE}`)
