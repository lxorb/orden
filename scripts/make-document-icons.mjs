import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BLUSH, INK, SKY } from './mark.mjs'

const OUT = 'apps/desktop/src-tauri/icons/documents'

const TYPES = {
  pdf: { label: 'PDF' },
}

const WINDOWS = [16, 20, 24, 32, 40, 48, 64, 256]
const MAC = [
  ['icp4', 16, 1],
  ['ic11', 16, 2],
  ['icp5', 32, 1],
  ['ic12', 32, 2],
  ['icp6', 64, 1],
  ['ic07', 128, 1],
  ['ic13', 128, 2],
  ['ic08', 256, 1],
  ['ic14', 256, 2],
  ['ic09', 512, 1],
  ['ic10', 512, 2],
]

const VARIANTS = {
  small: {
    page: [96, 16, 928, 1008],
    corner: 96,
    fold: 240,
    label: { height: 320, stroke: 100, gap: 0.28, y: 600 },
    outline: 56,
  },
  mid: {
    page: [144, 48, 880, 976],
    corner: 80,
    fold: 220,
    label: { height: 260, stroke: 86, gap: 0.24, y: 590 },
    outline: 32,
  },
  full: {
    page: [192, 80, 832, 944],
    corner: 56,
    fold: 176,
    label: { height: 200, stroke: 60, gap: 0.28, y: 580 },
    outline: 18,
  },
}
const variantOf = (size) => (size < 32 ? 'small' : size < 48 ? 'mid' : 'full')

const n = (v) => Number(v.toFixed(2))
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

const GLYPHS = {
  P: {
    width: 0.55,
    path: (x, y, h) => {
      const r = 0.27 * h
      const a = x + 0.28 * h
      return `M${n(x)} ${n(y + h)}V${n(y)}H${n(a)}A${n(r)} ${n(r)} 0 0 1 ${n(a)} ${n(y + 2 * r)}H${n(x)}`
    },
  },
  D: {
    width: 0.62,
    path: (x, y, h) => {
      const a = x + 0.12 * h
      return `M${n(x)} ${n(y)}H${n(a)}A${n(h / 2)} ${n(h / 2)} 0 0 1 ${n(a)} ${n(y + h)}H${n(x)}Z`
    },
  },
  F: {
    width: 0.5,
    path: (x, y, h) =>
      `M${n(x + 0.5 * h)} ${n(y)}H${n(x)}V${n(y + h)}M${n(x)} ${n(y + 0.48 * h)}H${n(x + 0.4 * h)}`,
  },
}

function label(text, { height, stroke, gap, y: middle }) {
  const letters = [...text].map((c) => {
    const glyph = GLYPHS[c]
    if (!glyph) throw new Error(`no glyph for ${c}`)
    return glyph
  })
  const width =
    letters.reduce((sum, g) => sum + g.width * height, 0) + gap * height * (letters.length - 1)
  let x = 512 - width / 2
  const y = middle - height / 2
  const d = letters
    .map((g) => {
      const part = g.path(x, y, height)
      x += (g.width + gap) * height
      return part
    })
    .join('')
  return `<path d="${d}" fill="none" stroke="${hex(INK)}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
}

function svg({ label: text }, variant) {
  const v = VARIANTS[variant]
  const [x0, y0, x1, y1] = v.page
  const r = v.corner
  const k = v.fold
  const page = `M${x0 + r} ${y0}H${x1 - k}L${x1} ${y0 + k}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`
  const f = Math.round(k / 4)
  const fold = `M${x1 - k} ${y0}V${y0 + k - f}A${f} ${f} 0 0 0 ${x1 - k + f} ${y0 + k}H${x1}Z`
  const line = `stroke="${hex(INK)}" stroke-opacity="0.3" stroke-width="${v.outline}" stroke-linejoin="round"`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '<defs>',
    `<linearGradient id="wash" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0" stop-color="${hex(SKY)}"/><stop offset="1" stop-color="${hex(BLUSH)}"/>`,
    '</linearGradient>',
    '</defs>',
    `<path d="${page}" fill="url(#wash)"/>`,
    label(text, v.label),
    `<path d="${page}" fill="none" ${line}/>`,
    `<path d="${fold}" fill="#FFFFFF" fill-opacity="0.7" ${line}/>`,
    '</svg>',
    '',
  ].join('\n')
}

function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(([size, data], i) => {
    const at = 6 + 16 * i
    head[at] = size >= 256 ? 0 : size
    head[at + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map(([, data]) => data)])
}

function icns(entries) {
  const parts = entries.map(([type, data]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + parts.reduce((sum, p) => sum + p.length, 0), 4)
  return Buffer.concat([head, ...parts])
}

const work = mkdtempSync(join(tmpdir(), 'orden-documents-'))
mkdirSync(OUT, { recursive: true })

for (const [ext, type] of Object.entries(TYPES)) {
  const wanted = { small: new Set(), mid: new Set(), full: new Set() }
  for (const size of WINDOWS) wanted[variantOf(size)].add(size)
  for (const [, size, scale] of MAC) wanted[variantOf(size)].add(size * scale)

  const drawn = {}
  for (const [variant, sizes] of Object.entries(wanted)) {
    const source = join(OUT, variant === 'full' ? `${ext}.svg` : `${ext}-${variant}.svg`)
    writeFileSync(source, svg(type, variant))
    const out = join(work, ext, variant)
    execSync(
      `pnpm --filter @orden/desktop exec tauri icon "${resolve(source)}" -o "${resolve(out)}" -p ${[...sizes].join(',')}`,
      { stdio: 'inherit' },
    )
    drawn[variant] = (size) => readFileSync(join(out, `${size}x${size}.png`))
  }

  writeFileSync(
    join(OUT, `${ext}.ico`),
    ico(WINDOWS.map((size) => [size, drawn[variantOf(size)](size)])),
  )
  writeFileSync(
    join(OUT, `${ext}.icns`),
    icns(MAC.map(([kind, size, scale]) => [kind, drawn[variantOf(size)](size * scale)])),
  )
  console.log(`${OUT}/${ext}.ico and ${ext}.icns`)
}

rmSync(work, { recursive: true, force: true })
