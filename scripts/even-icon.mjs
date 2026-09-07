/* The Nib mark as the Even Hub portal wants it: greyscale, no colour anywhere,
   as a foreground and a background of the same size.

   The portal takes the two separately and rejects a colour asset outright; the
   sizes it wants are not published, so this writes 24 and 256 and Emil uploads
   whichever the field asks for. The mark itself is the one in make-icon.mjs, in
   greys: the nib is white and everything around it is dark, which is the only
   way a shape reads on a panel that lights pixels rather than inking them.

   Dependency-free, like its sibling, so the repo stays clean.

     node scripts/even-icon.mjs [directory]      (default docs/even) */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The geometry of the mark, on the 1024 grid make-icon.mjs draws it on. */
const GRID = 1024
const corner = 224
const tip = [512, 812]
const left = [296, 236]
const right = [728, 236]
const hole = { x: 512, y: 430, r: 54 }
const slit = 13

/** The two greys. The ground is not black: an icon that is only a silhouette
   loses its rounded square on a dark list, and a fifth of the way up is enough
   to hold the shape without competing with the mark. */
const INK = 255
const GROUND = 52

const SS = 4

function inRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, corner), GRID - corner)
  const cy = Math.min(Math.max(y, corner), GRID - corner)
  return (
    (x - cx) ** 2 + (y - cy) ** 2 <= corner ** 2 ||
    (x >= 0 &&
      x <= GRID &&
      y >= 0 &&
      y <= GRID &&
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
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function inHole(x, y) {
  return (x - hole.x) ** 2 + (y - hole.y) ** 2 <= hole.r ** 2
}

function inSlit(x, y) {
  return Math.abs(x - hole.x) <= slit && y >= hole.y && y <= tip[1]
}

/** The grey at a point on the 1024 grid, or null outside the mark. */
function sample(x, y) {
  if (!inRoundedSquare(x, y)) return null
  return inTriangle(x, y) && !inHole(x, y) && !inSlit(x, y) ? INK : GROUND
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

/** Grey plus alpha, eight bits each: colour type 4. Nothing here has a hue, and
   a file that cannot carry one cannot be rejected for carrying one. */
function greyPng(size, at) {
  const raw = Buffer.alloc(size * (size * 2 + 1))
  let cursor = 0

  for (let y = 0; y < size; y++) {
    raw[cursor++] = 0
    for (let x = 0; x < size; x++) {
      let grey = 0
      let alpha = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const found = at(
            ((x + (sx + 0.5) / SS) / size) * GRID,
            ((y + (sy + 0.5) / SS) / size) * GRID,
          )
          if (found !== null) {
            grey += found
            alpha += 255
          }
        }
      }

      const n = SS * SS
      const opacity = alpha / n
      raw[cursor++] = opacity ? Math.round(grey / n / (opacity / 255)) : 0
      raw[cursor++] = Math.round(opacity)
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 4

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = process.argv[2] ?? join('docs', 'even')
mkdirSync(out, { recursive: true })

/** The background the portal asks for beside the icon: the same rounded square
   with nothing on it, so the two sit exactly on top of one another. */
const ground = (x, y) => (inRoundedSquare(x, y) ? GROUND : null)

for (const size of [24, 256]) {
  writeFileSync(join(out, `icon-${size}.png`), greyPng(size, sample))
  writeFileSync(join(out, `icon-background-${size}.png`), greyPng(size, ground))
  console.log(`${out}/icon-${size}.png and its background, ${size}x${size}, greyscale`)
}
