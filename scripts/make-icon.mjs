/* Draws the Orden mark and fans it out to every icon the apps ship, in one go:

     node scripts/make-icon.mjs

   Each platform gets the tile it expects, drawn from the shapes in mark.mjs
   rather than cut from one bitmap:
   - macOS: the squircle on Apple's grid (824 of 1024, the rest clear), so the
     Dock shows it the size of its neighbours and Tahoe has nothing to re-mask;
   - Windows, Linux and the Store tiles: the same squircle filling the square;
   - iOS: the wash to the very edge, because the system cuts its own corners;
   - Android: an adaptive pair, the wash behind and the bars in front inside the
     66 dp circle no launcher mask ever reaches, plus the one-colour layer that
     themed icons take;
   - the web app and the clipper: drawn straight at their sizes.
   `tauri icon` does the encoding (icns, ico, the Android and iOS sets); this
   script picks from three passes of it what each platform should keep. */

import { execSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { GRID, INK, inSquircle, onBars, png, wash } from './mark.mjs'

const TAURI = 'apps/desktop/src-tauri'
const ICONS = join(TAURI, 'icons')
const RES = join(TAURI, 'gen/android/app/src/main/res')

/** The bars sit on a tile 824 wide on the macOS grid and fill it everywhere else. */
const MAC = 824
/** On Android the visible 72 dp of a 108 dp layer is the tile, so the bars are drawn
   at two thirds of the layer and stay well inside its 66 dp safe circle. */
const ANDROID = (GRID * 72) / 108

const tile =
  (size, shape = inSquircle) =>
  (x, y) => {
    if (!shape(x, y, size)) return null
    return onBars(x, y, size) ? INK : wash(x, y, size)
  }
const edge = () => true

const work = mkdtempSync(join(tmpdir(), 'orden-icon-'))
const draw = (name, size, at) => {
  const path = join(work, name)
  writeFileSync(path, png(size, at))
  return path
}

const master = join(TAURI, 'icon-source.png')
writeFileSync(master, png(GRID, tile(GRID)))
draw('mac.png', GRID, tile(MAC))
draw('square.png', GRID, tile(GRID, edge))
draw('android-bg.png', GRID, (x, y) => wash(x, y, ANDROID))
draw('android-fg.png', GRID, (x, y) => (onBars(x, y, ANDROID) ? INK : null))
draw('android-mono.png', GRID, (x, y) => (onBars(x, y, ANDROID) ? [255, 255, 255] : null))
writeFileSync(
  join(work, 'mobile.json'),
  JSON.stringify({
    default: 'square.png',
    bg_color: '#BFDDFB',
    android_bg: 'android-bg.png',
    android_fg: 'android-fg.png',
    android_fg_scale: 100,
    android_monochrome: 'android-mono.png',
  }),
)

// pnpm runs the command inside apps/desktop, so every path it gets is absolute.
const fan = (input, out) =>
  execSync(`pnpm --filter @nib/desktop exec tauri icon "${resolve(input)}" -o "${resolve(out)}"`, {
    stdio: 'inherit',
  })
const desktop = join(work, 'desktop')
const mac = join(work, 'mac')
const mobile = join(work, 'mobile')
fan(master, desktop)
fan(join(work, 'mac.png'), mac)
fan(join(work, 'mobile.json'), mobile)

for (const file of readdirSync(desktop)) {
  if (file.endsWith('.png') || file === 'icon.ico')
    copyFileSync(join(desktop, file), join(ICONS, file))
}
copyFileSync(join(mac, 'icon.icns'), join(ICONS, 'icon.icns'))
for (const platform of ['ios', 'android']) {
  rmSync(join(ICONS, platform), { recursive: true, force: true })
  cpSync(join(mobile, platform), join(ICONS, platform), { recursive: true })
}
// Before Android 8 a launcher shows a plain bitmap; tauri makes it from the front
// layer alone, so the bars would fill it. Drawn here instead: the tile, and the
// disc for launchers that ask for a round one.
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const disc = (x, y, size) => Math.hypot(x - GRID / 2, y - GRID / 2) <= size / 2
for (const [density, size] of Object.entries(LEGACY)) {
  const dir = join(ICONS, 'android', `mipmap-${density}`)
  writeFileSync(join(dir, 'ic_launcher.png'), png(size, tile(GRID * 0.84)))
  writeFileSync(join(dir, 'ic_launcher_round.png'), png(size, tile(GRID * 0.92, disc)))
}
// The Android project builds from its own copy of the launcher set.
cpSync(join(ICONS, 'android'), RES, { recursive: true })

// The web icons ride in every download of the web app and the Even plugin, so they
// take the palette form.
const web = 'apps/desktop/public'
for (const size of [256, 512])
  writeFileSync(join(web, `icon-${size}.png`), png(size, tile(GRID, edge), { small: true }))
for (const size of [16, 32, 48, 128])
  writeFileSync(`apps/clipper/public/icons/${size}.png`, png(size, tile(GRID)))

rmSync(work, { recursive: true, force: true })
console.log('the Orden icon, every platform')
