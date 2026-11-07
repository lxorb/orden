import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin, type Rollup } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { englishIn, handedTo, inColumn, serverWords, stringsIn } from './even-catalogues.ts'
import { KEYS_MARK } from './src/lib/even/catalogue-keys.ts'
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

const CATALOGUE = /\/locales\/([\w-]+)\.ts$/

const NOT_DRAWN = new Set([
  'am',
  'ar',
  'bn',
  'fa',
  'gu',
  'hi',
  'kn',
  'ml',
  'mr',
  'my',
  'pa',
  'ps',
  'ta',
  'te',
  'th',
  'ur',
])

function twinOf(path: string, importer: string | undefined): string | null {
  if (path.includes('/node_modules/')) return null
  const twin = path.replace(/\.(ts|svelte)$/, '.even.$1')
  if (twin === path || importer?.replace(/\\/g, '/') === twin) return null

  return existsSync(twin) ? twin : null
}

const KATEX_SHEET = /\/katex\/dist\/katex(?:\.min)?\.css$/
const OLDER_FACES = /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g

function withoutWhatTheGlassesCannotUse() {
  const absent = '\0nib-absent'
  const runner = '\0nib-no-running'
  const catalogue = '\0nib-no-catalogue:'
  const emoji = '\0nib-slim-emoji:'
  const noFrames = '\0nib-no-frame-script'

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
      const id = CATALOGUE.exec(path)?.[1]
      if (id !== undefined && NOT_DRAWN.has(id)) return `${catalogue}${id}`

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

      if (asked.startsWith(catalogue)) {
        const id = asked.slice(catalogue.length)
        return `export const ${id.replace(/-/g, '_')} = {}\n`
      }

      return null
    },
  }
}

const KEYS_MODULE = resolve(import.meta.dirname, 'src/lib/even/catalogue-keys.ts').replace(
  /\\/g,
  '/',
)

function onlyTheRowsItAsksFor(): Plugin {
  let keys: string[] | undefined

  const shipped = (chunk: { facadeModuleId: string | null }) =>
    CATALOGUE.test(chunk.facadeModuleId?.replace(/\\/g, '/') ?? '')

  const keysIn = (chunks: Rollup.RenderedChunk[]) => {
    const asked = serverWords()
    const written = new Set<string>()
    for (const chunk of chunks) {
      for (const one of Object.values(chunk.modules)) {
        if (!one.code) continue
        if (shipped(chunk)) for (const english of englishIn(one.code)) written.add(english)
        else for (const text of stringsIn(one.code)) asked.add(text)
      }
    }

    return [...written].filter((english) => asked.has(english)).sort()
  }

  const placeholder = new RegExp(`\\[\\s*(["'\`])${KEYS_MARK}\\1\\s*\\]`)

  return {
    name: 'orden-even-rows',
    transform(code, id) {
      if (!CATALOGUE.test(id.replace(/\\/g, '/'))) return null

      return `import { rowsOf as nibRowsOf } from ${JSON.stringify(KEYS_MODULE)}\n${handedTo(code, 'nibRowsOf')}`
    },
    renderStart() {
      keys = undefined
    },
    renderChunk(code, chunk, _options, meta) {
      const holdsKeys = Object.keys(chunk.modules).some(
        (id) => id.replace(/\\/g, '/') === KEYS_MODULE,
      )
      if (!holdsKeys && !shipped(chunk)) return null

      keys ??= keysIn(Object.values(meta.chunks))
      if (shipped(chunk)) return inColumn(code, keys)

      if (!placeholder.test(code)) throw new Error('catalogue-keys.ts has no place for its keys')
      return code.replace(placeholder, JSON.stringify(keys))
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
    onlyTheRowsItAsksFor(),
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
