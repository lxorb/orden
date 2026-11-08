import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const TAURI = join(ROOT, 'apps/desktop/src-tauri')
const ICONS = join(TAURI, 'icons')
const RES = join(TAURI, 'gen/android/app/src/main/res')
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']

interface Picture {
  size: number
  colourType: number
  alpha: (x: number, y: number) => number
}

function decode(bytes: Buffer): Picture {
  let at = 8
  let size = 0
  let colourType = 0
  const data: Buffer[] = []
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      size = body.readUInt32BE(0)
      colourType = body[9] ?? 0
    }
    if (type === 'IDAT') data.push(body)
    at += 12 + length
  }
  const channels = ({ 6: 4, 4: 2, 3: 1 } as Record<number, number>)[colourType] ?? 3
  const raw = inflateSync(Buffer.concat(data))
  const stride = size * channels
  const out = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i] ?? 0
      const left = i >= channels ? (out[y * stride + i - channels] ?? 0) : 0
      const up = y > 0 ? (out[(y - 1) * stride + i] ?? 0) : 0
      const corner = y > 0 && i >= channels ? (out[(y - 1) * stride + i - channels] ?? 0) : 0
      const paeth = () => {
        const p = left + up - corner
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
        return a <= b && a <= c ? left : b <= c ? up : corner
      }
      const guess = [0, left, up, (left + up) >> 1, paeth()][filter] ?? 0
      out[y * stride + i] = (value + guess) & 0xff
    }
  }
  const px = (x: number, y: number) => (y * size + x) * channels
  return {
    size,
    colourType,
    alpha: (x, y) => (channels === 3 ? 255 : (out[px(x, y) + channels - 1] ?? 0)),
  }
}
const picture = (...parts: string[]) => decode(readFileSync(join(...parts)))

function icns1024(): Picture {
  const bytes = readFileSync(join(ICONS, 'icon.icns'))
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at + 4)
    if (bytes.toString('ascii', at, at + 4) === 'ic10')
      return decode(bytes.subarray(at + 8, at + length))
    at += length
  }
  throw new Error('icon.icns has no 1024 entry')
}

describe('the desktop icons', () => {
  test('every icon tauri.conf.json bundles exists', () => {
    const conf = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8')) as {
      bundle: { icon: string[] }
    }
    for (const icon of conf.bundle.icon) expect(existsSync(join(TAURI, icon)), icon).toBe(true)
  })

  test('the master is a 1024 squircle with clear corners', () => {
    const master = picture(TAURI, 'icon-source.png')

    expect(master.size).toBe(1024)
    expect(master.alpha(4, 4)).toBe(0)
    expect(master.alpha(512, 2)).toBe(255)
    expect(master.alpha(512, 512)).toBe(255)
  })

  test('the Mac icon keeps the clear margin of Apple’s grid', () => {
    const mac = icns1024()

    expect(mac.size).toBe(1024)
    expect(mac.alpha(512, 90)).toBe(0)
    expect(mac.alpha(512, 110)).toBe(255)
  })

  test('the Windows icons are squircles too', () => {
    for (const file of ['32x32.png', '128x128.png', 'icon.png', 'Square150x150Logo.png']) {
      const icon = picture(ICONS, file)
      expect(icon.alpha(0, 0), file).toBe(0)
      expect(icon.alpha(icon.size >> 1, icon.size >> 1), file).toBe(255)
    }
  })
})

describe('the document icons', () => {
  const DOCUMENTS = join(ICONS, 'documents')
  const opened = (
    JSON.parse(readFileSync(join(TAURI, 'tauri.linux.conf.json'), 'utf8')) as {
      bundle: { fileAssociations: { ext: string[] }[] }
    }
  ).bundle.fileAssociations.flatMap((one) => one.ext)
  const page = (icon: Picture, name: string) => {
    expect(icon.alpha(0, 0), name).toBe(0)
    expect(icon.alpha(icon.size - 1, 0), name).toBe(0)
    expect(icon.alpha(icon.size >> 1, icon.size >> 1), name).toBe(255)
  }

  test('every type Orden opens has its drawing and nothing else is drawn', () => {
    const files = readdirSync(DOCUMENTS).sort()
    const types = [...new Set(files.map((file) => file.replace(/(-\w+)?\.\w+$/, '')))]
    expect(types).toEqual([...opened].sort())
    for (const ext of opened) {
      for (const file of [`${ext}.svg`, `${ext}-mid.svg`, `${ext}-small.svg`]) {
        expect(readFileSync(join(DOCUMENTS, file), 'utf8'), file).toMatch(
          /^<svg [^>]*viewBox="0 0 1024 1024"/,
        )
      }
    }
  })

  test('every drawing is a page in the wash of Pass with the type in ink, no mark or badge', () => {
    for (const ext of opened) {
      for (const file of [`${ext}.svg`, `${ext}-mid.svg`, `${ext}-small.svg`]) {
        const drawing = readFileSync(join(DOCUMENTS, file), 'utf8')
        const colours = new Set(
          [...drawing.matchAll(/(?:fill|stroke|stop-color)="(#[0-9A-Fa-f]{6})"/g)].map((one) =>
            one[1]?.toLowerCase(),
          ),
        )
        expect([...colours].sort(), file).toEqual(['#1c2233', '#bfddfb', '#e7c6ec', '#ffffff'])
        expect(drawing, file).toContain('fill="url(#wash)"')
        expect(drawing, file).toMatch(/<path d="[^"]+" fill="none" stroke="#1c2233" stroke-width/i)
        expect(drawing, file).not.toContain('<rect')
      }
    }
  })

  test('the Windows icon holds every size Explorer asks for, each a page', () => {
    for (const ext of opened) {
      const bytes = readFileSync(join(DOCUMENTS, `${ext}.ico`))
      expect(bytes.readUInt16LE(2)).toBe(1)
      const sizes: number[] = []
      for (let i = 0; i < bytes.readUInt16LE(4); i++) {
        const at = 6 + 16 * i
        const size = bytes.readUInt8(at) || 256
        const png = bytes.subarray(
          bytes.readUInt32LE(at + 12),
          bytes.readUInt32LE(at + 12) + bytes.readUInt32LE(at + 8),
        )
        const icon = decode(png)
        expect(icon.size, `${ext} ${size}`).toBe(size)
        page(icon, `${ext}.ico ${size}`)
        sizes.push(size)
      }
      expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 256])
    }
  })

  test('the Mac icon holds every size Finder asks for, each a page', () => {
    const SIZES: Record<string, number> = {
      icp4: 16,
      ic11: 32,
      icp5: 32,
      ic12: 64,
      icp6: 64,
      ic07: 128,
      ic13: 256,
      ic08: 256,
      ic14: 512,
      ic09: 512,
      ic10: 1024,
    }
    for (const ext of opened) {
      const bytes = readFileSync(join(DOCUMENTS, `${ext}.icns`))
      expect(bytes.toString('ascii', 0, 4)).toBe('icns')
      expect(bytes.readUInt32BE(4)).toBe(bytes.length)
      const kinds: string[] = []
      for (let at = 8; at < bytes.length;) {
        const kind = bytes.toString('ascii', at, at + 4)
        const length = bytes.readUInt32BE(at + 4)
        const icon = decode(bytes.subarray(at + 8, at + length))
        expect(icon.size, `${ext} ${kind}`).toBe(SIZES[kind])
        page(icon, `${ext}.icns ${kind}`)
        kinds.push(kind)
        at += length
      }
      expect(kinds.sort()).toEqual(Object.keys(SIZES).sort())
    }
  })
})

describe('the mobile icons', () => {
  test('iOS is drawn to the edge', () => {
    for (const file of readdirSync(join(ICONS, 'ios'))) {
      const icon = picture(ICONS, 'ios', file)
      expect(icon.alpha(0, 0), file).toBe(255)
    }
  })

  test('Android ships an adaptive icon, in the project the app builds from', () => {
    for (const dir of [join(ICONS, 'android'), RES]) {
      const adaptive = readFileSync(join(dir, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8')
      for (const layer of ['foreground', 'background', 'monochrome']) {
        expect(adaptive).toContain(`@mipmap/ic_launcher_${layer}`)
        for (const density of DENSITIES) {
          expect(
            existsSync(join(dir, `mipmap-${density}`, `ic_launcher_${layer}.png`)),
            `${density} ${layer}`,
          ).toBe(true)
        }
      }
    }
  })

  test('the Android bars stay inside the safe circle', () => {
    for (const layer of ['foreground', 'monochrome']) {
      const fg = picture(RES, 'mipmap-xxxhdpi', `ic_launcher_${layer}.png`)
      const centre = fg.size / 2
      const safe = (fg.size * 33) / 108
      for (let y = 0; y < fg.size; y += 2) {
        for (let x = 0; x < fg.size; x += 2) {
          if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > safe) expect(fg.alpha(x, y)).toBe(0)
        }
      }
    }
  })
})

describe('the other places the mark appears', () => {
  test('the web app carries it at the size its names say', () => {
    for (const size of [256, 512])
      expect(picture(ROOT, 'apps/desktop/public', `icon-${size}.png`).size).toBe(size)
  })

  test('Pass on the web carries its own at the sizes its manifest says', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'apps/desktop/public/pass.webmanifest'), 'utf8'),
    ) as { icons: { src: string; sizes: string }[] }
    const drawn = manifest.icons.filter((icon) => icon.src.endsWith('.png'))
    expect(drawn.length).toBeGreaterThan(0)
    for (const icon of drawn) {
      const size = Number(icon.sizes.split('x')[0])
      expect(picture(ROOT, 'apps/desktop/public', icon.src.slice(1)).size, icon.src).toBe(size)
    }
  })

  test('Pass on the web rounds its icon as the Pass mark does in the app', () => {
    const PUBLIC = join(ROOT, 'apps/desktop/public')
    const third = /--radius-third:\s*([\d.]+)/.exec(
      readFileSync(join(ROOT, 'packages/themes/src/tokens.css'), 'utf8'),
    )?.[1]
    const svg = readFileSync(join(PUBLIC, 'pass.svg'), 'utf8')
    const tile = /<rect id="tile" width="(\d+)" height="\1" rx="(\d+)"/.exec(svg)
    expect(tile, 'pass.svg has a tile').not.toBeNull()
    expect(Number(tile?.[2]) / Number(tile?.[1])).toBeCloseTo(Number(third), 2)

    const page = readFileSync(join(ROOT, 'apps/desktop/pass.html'), 'utf8')
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'pass.webmanifest'), 'utf8')) as {
      icons: { src: string }[]
    }
    const linked = [...page.matchAll(/<link rel="icon" href="\/([^"]+)"/g)].map((one) => one[1])
    expect(linked).toContain('pass.svg')
    const rounded = [...linked, ...manifest.icons.map((icon) => icon.src.slice(1))].filter(
      (file): file is string => !!file?.endsWith('.png'),
    )
    expect(rounded.length).toBeGreaterThan(1)
    for (const file of rounded) {
      const icon = picture(PUBLIC, file)
      const last = icon.size - 1
      const half = Math.floor(icon.size / 2)
      for (const [x, y] of [
        [0, 0],
        [last, 0],
        [0, last],
        [last, last],
      ] as const)
        expect(icon.alpha(x, y), `${file} corner`).toBe(0)
      for (const [x, y] of [
        [half, 0],
        [0, half],
        [half, half],
      ] as const)
        expect(icon.alpha(x, y), `${file} edge`).toBe(255)
    }

    const touch = /<link rel="apple-touch-icon" href="\/([^"]+)"/.exec(page)?.[1] ?? ''
    const ios = picture(PUBLIC, touch)
    expect(ios.alpha(0, 0), 'iOS rounds the touch icon itself and paints clear corners black').toBe(
      255,
    )
  })

  test('the Even icons are greyscale', () => {
    for (const file of [
      'icon-24.png',
      'icon-256.png',
      'icon-background-24.png',
      'icon-background-256.png',
    ]) {
      expect(picture(ROOT, 'docs/even', file).colourType, file).toBe(4)
    }
  })
})
