import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

/** What the shipped icons promise, read off the files `scripts/make-icon.mjs` and
 *  `scripts/even-icon.mjs` wrote.
 *
 *  The icons are binaries nobody reviews by eye in a diff, so the shape each
 *  platform needs is held here instead: the macOS tile on Apple's grid with its
 *  clear margin, Windows and Linux squircles with clear corners, iOS and the web
 *  edge to edge, an Android adaptive set whose bars stay inside the 66 dp circle
 *  every launcher mask leaves alone, and Even assets with no colour in them. */

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

/** Enough of PNG to read the files above: 8-bit RGBA, grey-alpha or indexed, any filter. */
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

/** The ICNS entry Apple calls ic10, the 1024 pixel PNG. */
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

  /** The master is the tile itself: clear in the corners, solid through the middle. */
  test('the master is a 1024 squircle with clear corners', () => {
    const master = picture(TAURI, 'icon-source.png')

    expect(master.size).toBe(1024)
    expect(master.alpha(4, 4)).toBe(0)
    expect(master.alpha(512, 2)).toBe(255)
    expect(master.alpha(512, 512)).toBe(255)
  })

  /** Apple's grid puts an 824 tile in the 1024 canvas, so a Mac icon stands as tall
   *  as its neighbours in the Dock rather than a size larger. */
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

describe('the mobile icons', () => {
  /** iOS cuts its own corners, and fills anything clear with black. */
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

  /** Launchers cut the 108 dp layer to any shape that holds a 66 dp circle, so a bar
   *  outside that circle would be clipped on some phone. */
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

  /** The Even Hub portal refuses a colour asset, so these cannot carry one at all. */
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
