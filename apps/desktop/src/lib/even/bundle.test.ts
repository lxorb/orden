import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { undrawable } from '@orden/glasses'
import { serverWords, stringsIn } from '../../../even-catalogues'
import {
  APP_FOLDERS,
  BUDGETS,
  LIBRARIES,
  PACKAGES,
  type Part,
  partOf,
  sourceOf,
} from '../../../even-contents'
import manifest from '../../../even.app.json'
import type { Dictionary } from '../i18n.svelte'

const app = resolve(import.meta.dirname, '../../..')
const staged = mkdtempSync(join(tmpdir(), 'nib-even-'))
const contents = `${staged}.json`

const allowed = manifest.permissions.find((one) => one.name === 'network')?.whitelist ?? []

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }

  return out
}

let files: { name: string; text: string }[] = []

const WRITTEN = import.meta.glob<Record<string, Dictionary>>('../../locales/*.ts')
const languageOf = (path: string) => /([\w-]+)\.ts$/.exec(path)?.[1] ?? path

const catalogues = new Map<string, string>()

const KEYS_CHUNK = /^catalogue-keys-[\w-]{8}\.js$/

let asked = new Set<string>()

beforeAll(() => {
  execFileSync(
    'pnpm',
    ['exec', 'vite', 'build', '--config', 'vite.even.config.ts', '--outDir', staged],
    {
      cwd: app,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: 'production', NIB_EVEN_CONTENTS: contents },
    },
  )
  execFileSync('node', [resolve(app, '../../scripts/even-stage.mjs'), staged, staged], {
    cwd: app,
    stdio: 'pipe',
  })

  files = walk(staged)
    .filter((one) => /\.(js|css|html|json|webmanifest)$/.test(one))
    .map((one) => ({ name: one.slice(staged.length + 1), text: readFileSync(one, 'utf8') }))

  const code = files.filter((one) => one.name.endsWith('.js'))
  for (const path of Object.keys(WRITTEN)) {
    const id = languageOf(path)
    const chunk = code.find((one) => new RegExp(`^${id}-[\\w-]{8}\\.js$`).test(basename(one.name)))
    if (chunk) catalogues.set(id, chunk.name)
  }
  const shipping = new Set(catalogues.values())
  for (const one of code) if (KEYS_CHUNK.test(basename(one.name))) shipping.add(one.name)
  asked = serverWords()
  for (const one of code) {
    if (shipping.has(one.name)) continue
    for (const text of stringsIn(one.text)) asked.add(text)
  }
}, 300_000)

afterAll(() => {
  rmSync(staged, { recursive: true, force: true })
  rmSync(contents, { force: true })
})

describe('the bundle a package is made of', () => {
  test('is there at all, and is the plugin under both names', () => {
    expect(files.length).toBeGreaterThan(10)
    const both = files.filter((one) => one.name === 'even.html' || one.name === 'index.html')
    expect(both).toHaveLength(2)
    expect(both[0]?.text).toBe(both[1]?.text)
  })

  test('carries no URL the manifest does not allow', () => {
    const off: string[] = []

    for (const file of files) {
      for (const found of file.text.matchAll(/https?:\/\/[^\s"'`)\\<>]*/g)) {
        const url = found[0]
        if (allowed.some((one) => url.startsWith(one))) continue
        off.push(`${url}   [${file.name}]`)
      }
    }

    expect(off.slice(0, 12).join('\n')).toBe('')
  })

  test('keeps the XML namespaces exactly, in whatever the file spells them with', () => {
    const spellings = ['http:\\/\\/www.w3.org', 'http%3A//www.w3.org', 'http&#58;//www.w3.org']
    const wrong: string[] = []
    let held = 0

    for (const file of files) {
      for (const found of file.text.matchAll(/.{0,12}www\.w3\.org/g)) {
        held++
        if (!spellings.some((one) => found[0].endsWith(one))) {
          wrong.push(`${file.name}: ...${found[0]}`)
        }
      }
    }

    expect(wrong.slice(0, 6).join('\n')).toBe('')
    expect(held).toBeGreaterThan(5)
  })

  test('holds the whitelist to the manifest, so the two cannot drift', () => {
    expect(allowed.length).toBeGreaterThan(0)
    for (const one of allowed) expect(one).toMatch(/^https:\/\//)
  })

  test('turns no string into code, by any of the ways there are', () => {
    const ways = [
      /new\s+Function\s*\(/,
      /[^.\w$]Function\s*\(/,
      /[^.\w$]eval\s*[()]/,
      /set(?:Timeout|Interval)\s*\(\s*['"`]/,
    ]

    const found: string[] = []
    for (const file of files) {
      for (const way of ways) {
        const at = way.exec(file.text)
        if (at)
          found.push(
            `${file.name}: ...${file.text.slice(Math.max(0, at.index - 60), at.index + 40)}`,
          )
      }
    }

    expect(found.slice(0, 6).join('\n\n')).toBe('')
  })

  test('has no way to run a fence, and no button offering to', () => {
    const runner = files.filter(
      (one) =>
        one.name.endsWith('.js') &&
        (one.text.includes('nib-run-panel') || one.text.includes('nib-run-output')),
    )

    expect(runner.map((one) => one.name)).toEqual([])
  })

  test('and none of the sandbox that would have run it', () => {
    for (const file of files) {
      if (!file.name.endsWith('.js')) continue
      expect(file.text, file.name).not.toContain('nib-run')
    }
  })

  test('leaves out the libraries a pair of glasses cannot use', () => {
    const gone: Record<string, string> = {
      mermaid: 'mermaid-js/mermaid',
      chevrotain: 'chevrotain',
      cytoscape: 'cytoscape',
      docx: 'wordprocessingml',
      jszip: 'JSZip',
      'flowchart.js': 'raphaeljs',
      'pdfjs-dist': 'pdfjs_internal',
    }

    const here = Object.entries(gone)
      .filter(([, mark]) => files.some((one) => one.text.includes(mark)))
      .map(([name]) => name)

    expect(here).toEqual([])
  })

  test('and none of the surfaces it never opens: the canvas, a page note, their thumbnails', () => {
    const surfaces = files
      .map((one) => basename(one.name))
      .filter((name) => /^(Canvas|Pages|PagesNavigator)-[\w-]{8}\.js$/.test(name))

    expect(surfaces).toEqual([])
  })

  test('and none of what only a desktop does: its plans and its updater', () => {
    const commands = [
      'ai_cli_status',
      'ai_cli_ask',
      'chatgpt_sign_in',
      'chatgpt_account',
      'chatgpt_token',
      'check_update',
      'ai_thread_write',
      'ai_agent_call',
    ]
    const here = commands.filter((name) =>
      files.some((one) => one.name.endsWith('.js') && one.text.includes(name)),
    )

    expect(here).toEqual([])
  })

  test('is a production build, as a release is', () => {
    const dev = files.filter((one) => one.text.includes('`src/App.svelte`'))
    expect(dev.map((one) => one.name)).toEqual([])
  })

  test('brings the icons a space can wear, shapes and names both', () => {
    const code = files.filter((one) => one.name.endsWith('.js'))

    expect(code.some((one) => one.text.includes('createIcons'))).toBe(true)

    const shapes = code.reduce(
      (sum, one) => sum + (one.text.match(/[{,]\s*"?d"?\s*:\s*['"`]M/g)?.length ?? 0),
      0,
    )
    expect(shapes).toBeGreaterThan(2000)

    for (const name of ['GraduationCap', 'Book', 'SquareCheck', 'Newspaper']) {
      const held = code.some((one) => new RegExp(`\\b${name}\\b`).test(one.text))
      expect(held, name).toBe(true)
    }
  })

  test('carries every emoji by name, and nothing else of the table', () => {
    const code = files.filter((one) => one.name.endsWith('.js'))

    expect(code.some((one) => one.text.includes('slightly_smiling_face'))).toBe(true)
    expect(code.some((one) => one.text.includes('fitzpatrick_scale'))).toBe(false)
  })

  test('and that slim map is the full one, row for row', () => {
    const glasses = createRequire(resolve(app, '../../packages/glasses/package.json'))
    const table = createRequire(glasses.resolve('node-emoji'))
    const folder = dirname(table.resolve('emojilib'))
    const read = (name: string) => JSON.parse(readFileSync(join(folder, name), 'utf8')) as unknown

    const full = read('emojis.json') as Record<string, { char: string }>
    const slim = read('simplemap.json') as Record<string, string>

    expect(Object.entries(slim)).toEqual(
      Object.entries(full).map(([name, row]) => [name, row.char]),
    )
  })

  describe('what came in', () => {
    const allowed = new Set([
      ...LIBRARIES.map((name) => `library ${name}`),
      ...PACKAGES.map((name) => `package ${name}`),
      ...APP_FOLDERS.map((name) => `folder ${name}`),
    ])
    const found = () => {
      const modules = JSON.parse(readFileSync(contents, 'utf8')) as Record<string, number>
      return new Set(Object.keys(modules).flatMap((one) => sourceOf(one) ?? []))
    }

    test('is all named in even-contents.ts', () => {
      expect([...found()].filter((one) => !allowed.has(one))).toEqual([])
    })

    test('and nothing named there has gone', () => {
      const here = found()
      expect([...allowed].filter((one) => !here.has(one))).toEqual([])
    })
  })

  test('weighs what each part of it may', () => {
    const parts: Record<Part, number> = { code: 0, catalogues: 0, styles: 0, fonts: 0, pages: 0 }
    const catalogue = new Set(catalogues.values())
    for (const path of walk(staged)) {
      const name = path.slice(staged.length + 1)
      const words = catalogue.has(name) || KEYS_CHUNK.test(basename(name))
      parts[partOf(name, words)] += statSync(path).size
    }

    const over = Object.entries(parts)
      .filter(([part, bytes]) => bytes > BUDGETS[part as Part])
      .map(([part, bytes]) => `${part}: ${bytes} of ${BUDGETS[part as Part]}`)
    expect(over).toEqual([])
  })

  test('carries the maths faces once, as woff2', () => {
    const names = walk(staged).map((one) => basename(one))
    expect(names.filter((one) => /\.(woff|ttf)$/.test(one))).toEqual([])
    expect(names.filter((one) => one.startsWith('KaTeX_')).length).toBeGreaterThan(10)
  })

  test('writes the English its catalogues share once', () => {
    const keys = files.filter((one) => KEYS_CHUNK.test(basename(one.name)))
    expect(keys).toHaveLength(1)
    const german = files.find((one) => one.name === catalogues.get('de'))
    expect(keys[0]?.text).toContain('Add task')
    expect(german?.text).toContain('Aufgabe hinzufügen')
    expect(german?.text).not.toContain('Add task')
  })

  test('is small enough for the platform to be comfortable with', () => {
    const bytes = walk(staged).reduce((sum, one) => sum + statSync(one).size, 0)
    expect(bytes).toBeLessThan(8 * 1024 * 1024)
  })

  test('ships the catalogues the firmware can draw, and only those', () => {
    const where = resolve(app, 'src/locales')
    const catalogues = readdirSync(where).filter((one) => one.endsWith('.ts'))
    expect(catalogues.length).toBeGreaterThan(30)

    const chunks = files.map((one) => one.name.split(/[\\/]/).at(-1) ?? '')
    const wrong: string[] = []

    for (const name of catalogues) {
      const id = name.replace('.ts', '')
      const share = undrawable(readFileSync(resolve(where, name), 'utf8'))
      const shipped = chunks.some((one) => new RegExp(`^${id}-[\\w-]+\\.js$`).test(one))

      if (share > 0.1 && shipped) wrong.push(`${id} is ${(share * 100).toFixed(1)}% boxes, shipped`)
      if (share <= 0.1 && !shipped) wrong.push(`${id} is drawable and is not in the package`)
    }

    expect(wrong.join('\n')).toBe('')
  }, 240_000)

  describe('the rows of each catalogue it ships', () => {
    const shipped: { id: string; file: string; rows: Dictionary; written: Dictionary }[] = []

    beforeAll(async () => {
      const read = async (from: Promise<Record<string, Dictionary>>) =>
        Object.values(await from)[0] ?? {}

      const loading = Object.entries(WRITTEN).flatMap(([path, load]) => {
        const id = languageOf(path)
        const file = catalogues.get(id)
        if (!file) return []
        const url = pathToFileURL(join(staged, file)).href
        const both = Promise.all([
          read(import(url) as Promise<Record<string, Dictionary>>),
          read(load()),
        ])
        return [both.then(([rows, written]) => ({ id, file, rows, written }))]
      })
      shipped.push(...(await Promise.all(loading)))
    })

    test('are all found', () => {
      expect(shipped.length).toBeGreaterThan(20)
    })

    test('hold every row the plugin can ask for, as it is written', () => {
      const missing = shipped.flatMap(({ id, rows, written }) =>
        Object.keys(written)
          .filter((english) => asked.has(english))
          .filter((english) => JSON.stringify(rows[english]) !== JSON.stringify(written[english]))
          .map((english) => `${id}: ${english}`),
      )

      expect(missing.slice(0, 12).join('\n')).toBe('')
    })

    test('and not one it cannot', () => {
      const unused = shipped.flatMap(({ id, rows }) =>
        Object.keys(rows)
          .filter((english) => !asked.has(english))
          .map((english) => `${id}: ${english}`),
      )

      expect(unused.slice(0, 12).join('\n')).toBe('')
    })
  })
})
