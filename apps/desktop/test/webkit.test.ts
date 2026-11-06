import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const SOURCES = [
  'apps/desktop/src',
  'packages/editor/src',
  'packages/markdown/src',
  'packages/themes/src',
  'packages/bases/src',
  'packages/chats/src',
  'packages/glasses/src',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path)
    return /\.(ts|svelte|css|js)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const files = SOURCES.flatMap((one) => walk(join(ROOT, one))).map((path) => ({
  name: relative(ROOT, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}))

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function blocks(text: string): string[] {
  return [...code(text).matchAll(/\{[^{}]*\}/g)].map((one) => one[0])
}

const sheets = files.filter((one) => /\.(css|svelte)$/.test(one.name))

const PREFIXED = ['user-select', 'backdrop-filter']

const MISSING: [string, RegExp, RegExp][] = [
  ['requestIdleCallback', /\brequestIdleCallback\s*\(/, /typeof requestIdleCallback/],
  ['cancelIdleCallback', /\bcancelIdleCallback\s*\(/, /typeof requestIdleCallback|hasIdle/],
  ['scheduler', /(^|[^.\w])scheduler\.(yield|postTask)/m, /globalThis/],
  [
    'showOpenFilePicker',
    /\bshow(Open|Save)FilePicker\s*\(|\bshowDirectoryPicker\s*\(/,
    /in window/,
  ],
  ['navigator.locks', /navigator\.locks\s*\.request/, /navigator\.locks\s*\?|typeof navigator/],
]

describe("a Mac's WebKit", () => {
  test('the scan reads the app', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(sheets.some((one) => one.name.endsWith('base.css'))).toBe(true)
  })

  for (const property of PREFIXED) {
    test(`reads ${property} only with -webkit- beside it`, () => {
      const bare = new RegExp(`(^|[^-\\w])${property}\\s*:`)
      const prefixed = new RegExp(`-webkit-${property}\\s*:`)
      const loose = sheets.flatMap((one) =>
        blocks(one.text)
          .filter((block) => bare.test(block) && !prefixed.test(block))
          .map((block) => `${one.name}: ${block.replace(/\s+/g, ' ').slice(0, 90)}`),
      )
      expect(loose).toEqual([])
    })
  }

  test('has no style.userSelect, so a drag holds selection off with .nib-unselectable', () => {
    const written = files.filter((one) => /\.style\.userSelect\b/.test(code(one.text)))
    expect(written.map((one) => one.name)).toEqual([])
  })

  for (const [name, used, asked] of MISSING) {
    test(`lacks ${name}, which is asked about wherever it is used`, () => {
      const unasked = files.filter((one) => {
        const body = code(one.text)
        return used.test(body) && !asked.test(body)
      })
      expect(unasked.map((one) => one.name)).toEqual([])
    })
  }

  test('sizes a field to its words only through grow where it cannot itself', () => {
    const fields = files.filter((one) => /field-sizing:\s*content/.test(code(one.text)))
    expect(fields.length).toBeGreaterThan(0)
    const unsized = fields.filter((one) => !/use:grow\b/.test(one.text))
    expect(unsized.map((one) => one.name)).toEqual([])
  })
})
