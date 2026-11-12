import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inSquircle, onBars, png } from './mark.mjs'

const INK = 255
const GROUND = 52

const mark = (x, y) => (inSquircle(x, y) ? (onBars(x, y) ? INK : GROUND) : null)

const ground = (x, y) => (inSquircle(x, y) ? GROUND : null)

const out = process.argv[2] ?? join('target', 'even')
mkdirSync(out, { recursive: true })

for (const size of [24, 256]) {
  writeFileSync(join(out, `icon-${size}.png`), png(size, mark, { grey: true }))
  writeFileSync(join(out, `icon-background-${size}.png`), png(size, ground, { grey: true }))
  console.log(`${out}/icon-${size}.png and its background, ${size}x${size}, greyscale`)
}
