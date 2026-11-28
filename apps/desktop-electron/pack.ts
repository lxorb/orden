import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const here = import.meta.dirname
const core = process.argv[2]
if (!core) {
  console.error('usage: node pack.ts <core binary>')
  process.exit(2)
}
const mac = process.platform === 'darwin'
const suffix = process.platform === 'win32' ? '.exe' : ''
const electron = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
const out = join(here, 'dist', 'orden-electron')
const resources = mac ? join(out, 'Electron.app', 'Contents', 'Resources') : join(out, 'resources')
const app = join(resources, 'app')
await rm(out, { recursive: true, force: true })
await mkdir(dirname(out), { recursive: true })
await cp(join(electron, 'dist'), out, { recursive: true, verbatimSymlinks: true })
await rm(join(resources, 'default_app.asar'), { force: true })
await mkdir(app, { recursive: true })
for (const file of ['main.cjs', 'preload.cjs', 'icon.png']) await cp(join(here, 'dist', file), join(app, file))
await writeFile(
  join(app, 'package.json'),
  JSON.stringify({ name: 'orden-electron', productName: 'Orden Electron', version: '0.0.0', main: 'main.cjs' }),
)
await cp(core, join(resources, `orden-core${suffix}`))
await chmod(join(resources, `orden-core${suffix}`), 0o755)
console.error(mac ? join(out, 'Electron.app', 'Contents', 'MacOS', 'Electron') : join(out, `electron${suffix}`))
