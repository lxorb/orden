import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import manifest from './even.app.json'

const LEFT_OUT = new Set([
  'mermaid',
  'flowchart.js',
  '@codemirror/legacy-modes/mode/pug',
  'pdfjs-dist',
  'pdfjs-dist/build/pdf.worker.min.mjs?url',
  'pdfjs-dist/legacy/build/pdf.mjs',
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',
  'unicode-emoji-json/data-by-group.json',
  '@iconify-json/flat-color-icons/icons.json',
  '@iconify-json/simple-icons/icons.json',
  '@iconify-json/fluent-emoji-high-contrast/icons.json',
  '@iconify-json/fluent-emoji-high-contrast/chars.json',
  'virtual:noto-outlines',
  'lucide-static/tags.json',
  'emojilib/emojis.json',
  'tldts',
])

const ABSENT = `
const gone = () => {
  throw new Error('not in the Even Realities plugin')
}

export default new Proxy({}, { get: gone, apply: gone })
`

const NO_RUNNING = `
export function runExtension() {
  return []
}
export function runFenceAtCursor() {
  return false
}
export function isRunnableLanguage() {
  return false
}
export function runnableFenceAt() {
  return null
}
export function runFence() {
  return false
}
`

const RUNNER = 'packages/editor/src/run/door'

const FRAME_SCRIPT = /frame-script\.js\?raw$/

const EMOJI_TABLE = /\/emojilib\/index\.js$/

const SLIM_EMOJI = (folder: string) => `
import names from ${JSON.stringify(`${folder}/simplemap.json`)}

export default {
  lib: Object.fromEntries(Object.entries(names).map(([name, char]) => [name, { char }])),
}
`

function twinOf(path: string, importer: string | undefined): string | null {
  if (path.includes('/node_modules/')) return null
  const twin = path.replace(/\.(ts|svelte)$/, '.even.$1')
  if (twin === path || importer?.replace(/\\/g, '/') === twin) return null

  return existsSync(twin) ? twin : null
}

const KATEX_SHEET = /\/katex\/dist\/katex(?:\.min)?\.css$/
const OLDER_FACES = /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g

function withoutWhatTheGlassesCannotUse() {
  const absent = '\0orden-absent'
  const runner = '\0orden-no-running'
  const emoji = '\0orden-slim-emoji:'
  const noFrames = '\0orden-no-frame-script'

  return {
    name: 'orden-even-without',
    enforce: 'pre' as const,
    async resolveId(source: string, importer: string | undefined, options: object) {
      if (LEFT_OUT.has(source)) return absent
      if (FRAME_SCRIPT.test(source)) return noFrames

      const found = await (this as unknown as Resolver).resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      if (!found) return null

      const path = found.id.replace(/\\/g, '/')
      if (EMOJI_TABLE.test(path)) return `${emoji}${path.replace(/\/index\.js$/, '')}`

      if (path.includes(RUNNER)) return runner

      return twinOf(path, importer)
    },
    transform(code: string, id: string) {
      return KATEX_SHEET.test(id.split('?')[0] ?? id) ? code.replace(OLDER_FACES, '') : null
    },
    load(asked: string) {
      if (asked === absent) return ABSENT
      if (asked === runner) return NO_RUNNING
      if (asked === noFrames) return "export default ''\n"
      if (asked.startsWith(emoji)) return SLIM_EMOJI(asked.slice(emoji.length))

      return null
    },
  }
}

function whatWentIn(file: string | undefined): Plugin {
  const repo = resolve(import.meta.dirname, '../..').replace(/\\/g, '/')

  return {
    name: 'orden-even-contents',
    generateBundle(_options, bundle) {
      if (!file) return

      const modules: Record<string, number> = {}
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
          const path = id.replace(/\\/g, '/').replace(`${repo}/`, '')
          modules[path] = (modules[path] ?? 0) + renderedLength
        }
      }
      writeFileSync(file, JSON.stringify(modules))
    },
  }
}

interface Resolver {
  resolve(
    source: string,
    importer: string | undefined,
    options: object,
  ): Promise<{ id: string } | null>
}

export default defineConfig({
  plugins: [
    svelte(),
    withoutWhatTheGlassesCannotUse(),
    whatWentIn(process.env.ORDEN_EVEN_CONTENTS),
  ],
  define: {
    __EVEN_BUILD__: JSON.stringify(`${manifest.version} even`),
    __EVEN_PLUGIN__: 'true',
    __DRIVEABLE__: 'false',
    __APP_VERSION__: JSON.stringify(manifest.version),
    __APP_COMMIT__: JSON.stringify(''),
    __CLAUDE_CODE__: 'false',
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'esnext',
    outDir: 'dist-even',
    emptyOutDir: true,
    rollupOptions: {
      input: { even: resolve(import.meta.dirname, 'even.html') },
    },
  },
})
