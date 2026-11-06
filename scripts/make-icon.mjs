import { execSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { GRID, INK, inSquircle, onBars, png, wash } from './mark.mjs'

const TAURI = 'apps/desktop/src-tauri'
const ICONS = join(TAURI, 'icons')
const RES = join(TAURI, 'gen/android/app/src/main/res')

const MAC = 824
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

const fan = (input, out) =>
  execSync(
    `pnpm --filter @orden/desktop exec tauri icon "${resolve(input)}" -o "${resolve(out)}"`,
    {
      stdio: 'inherit',
    },
  )
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
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const disc = (x, y, size) => Math.hypot(x - GRID / 2, y - GRID / 2) <= size / 2
for (const [density, size] of Object.entries(LEGACY)) {
  const dir = join(ICONS, 'android', `mipmap-${density}`)
  writeFileSync(join(dir, 'ic_launcher.png'), png(size, tile(GRID * 0.84)))
  writeFileSync(join(dir, 'ic_launcher_round.png'), png(size, tile(GRID * 0.92, disc)))
}
cpSync(join(ICONS, 'android'), RES, { recursive: true })

const web = 'apps/desktop/public'
for (const size of [256, 512])
  writeFileSync(join(web, `icon-${size}.png`), png(size, tile(GRID, edge), { small: true }))

rmSync(work, { recursive: true, force: true })
console.log('the Orden icon, every platform')
