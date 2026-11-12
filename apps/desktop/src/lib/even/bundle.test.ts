import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
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

const app = resolve(import.meta.dirname, '../../..')
const staged = mkdtempSync(join(tmpdir(), 'orden-even-'))
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

beforeAll(() => {
  execFileSync(
    'pnpm',
    ['exec', 'vite', 'build', '--config', 'vite.even.config.ts', '--outDir', staged],
    {
      cwd: app,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: 'production', ORDEN_EVEN_CONTENTS: contents },
    },
  )
  execFileSync('node', [resolve(app, '../../scripts/even-stage.mjs'), staged, staged], {
    cwd: app,
    stdio: 'pipe',
  })

  files = walk(staged)
    .filter((one) => /\.(js|css|html|json|webmanifest)$/.test(one))
    .map((one) => ({ name: one.slice(staged.length + 1), text: readFileSync(one, 'utf8') }))
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
        (one.text.includes('orden-run-panel') || one.text.includes('orden-run-output')),
    )

    expect(runner.map((one) => one.name)).toEqual([])
  })

  test('and none of the sandbox that would have run it', () => {
    for (const file of files) {
      if (!file.name.endsWith('.js')) continue
      expect(file.text, file.name).not.toContain('orden-run')
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
    const parts: Record<Part, number> = { code: 0, styles: 0, fonts: 0, pages: 0 }
    for (const path of walk(staged)) {
      parts[partOf(path.slice(staged.length + 1))] += statSync(path).size
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

  test('is small enough for the platform to be comfortable with', () => {
    const bytes = walk(staged).reduce((sum, one) => sum + statSync(one).size, 0)
    expect(bytes).toBeLessThan(8 * 1024 * 1024)
  })
})
