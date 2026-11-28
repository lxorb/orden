import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const here = import.meta.dirname
const out = join(here, 'dist')
await mkdir(out, { recursive: true })
await build({
  entryPoints: { main: join(here, 'src', 'main.ts'), preload: join(here, 'src', 'preload.ts') },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
})
await copyFile(join(here, '..', 'desktop', 'src-tauri', 'icons', 'icon.png'), join(out, 'icon.png'))
