import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SKIP = /^(?:node_modules|target|coverage|gen|locales)$|^\.|^dist/

function skipped(name: string): boolean {
  return SKIP.test(name)
}

const SPOKEN = ['title', 'aria-label', 'placeholder', 'alt']

const MARKS = [0x2014, 0x2013, 0x00d7, 0x00b7].map((one) => String.fromCharCode(one)).join('')

const EXEMPT = [
  new RegExp(`^[\\s\\d.,:;!?/|<>${MARKS}-]*$`),
  /^(Ctrl|Alt|Shift|Cmd|Meta|F\d)\b/,
  /^[a-z0-9-]+$/,
  /^\{/,
  /@example\.com$/,
  /^notes\.example\.com$/,
  /^your-name$/,
  /^https:\/\//,
  /^example\.com$/,
  /^\.?(orden\.so|nibeditor\.com)$/,
  /^(B|I|S|M|H|<>|#|"|×)$/,
  /^(A3|A4|A5|Letter|Legal|PDF|HTML|MCP|LLM|CSS|DNS|JSON)$/,
  /^(Word|OpenOffice|RTF|ePub|LaTeX|MediaWiki|reStructuredText|Textile|OPML)$/,
  /^(Markdown|TextBundle|JPG|PNG|SVG)$/,
  /^(Claude|Claude Code|ChatGPT|Codex|OAuth)$/,
  /^Orden$/,
]

const exempt = (text: string) => EXEMPT.some((pattern) => pattern.test(text.trim()))

const files = sources(ROOT)

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    if (entry.isDirectory()) {
      if (!skipped(name)) sources(join(dir, name), found)
      continue
    }

    if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) found.push(join(dir, name))
  }

  return found
}

function template(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function relative(path: string): string {
  return path.slice(ROOT.length).replace(/\\/g, '/')
}

interface Finding {
  where: string
  text: string
}

function loosePhrases(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const [, phrase = ''] of body.matchAll(/>([^<>{}]+)</g)) {
    const text = phrase.trim()
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: relative(path), text })
  }

  return found
}

function looseAttributes(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const name of SPOKEN) {
    for (const [, written = ''] of body.matchAll(new RegExp(`\\b${name}="([^"{}]+)"`, 'g'))) {
      const text = written.trim()
      if (!/[A-Za-z]/.test(text) || exempt(text)) continue

      found.push({ where: `${relative(path)} (${name})`, text })
    }
  }

  return found
}

function looseLabels(path: string, source: string): Finding[] {
  const found: Finding[] = []

  for (const [, , written = ''] of source.matchAll(/\blabel:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const text = written.trim()
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: `${relative(path)} (label)`, text })
  }

  return found
}

describe('the walk', () => {
  test('never goes into build output', () => {
    for (const name of ['dist', 'dist-even', 'dist-anything', 'node_modules', 'target']) {
      expect(skipped(name), name).toBe(true)
    }

    expect(files.some((path) => /(?:^|\/)dist/.test(relative(path)))).toBe(false)
  })

  test('goes into the folders the source is actually in', () => {
    for (const name of ['src', 'lib', 'test', 'export', 'even']) {
      expect(skipped(name), name).toBe(false)
    }

    expect(files.some((path) => path.endsWith('.svelte'))).toBe(true)
    expect(files.some((path) => /(?:^|\/)src\/lib\//.test(relative(path)))).toBe(true)
  })
})

describe('everything the reader sees is translated', () => {
  test('no loose phrases in the markup', () => {
    const found = files
      .filter((p) => p.endsWith('.svelte'))
      .flatMap((p) => loosePhrases(p, readFileSync(p, 'utf8')))
    expect(found).toEqual([])
  })

  test('no loose titles, labels or placeholders', () => {
    const found = files
      .filter((p) => p.endsWith('.svelte'))
      .flatMap((p) => looseAttributes(p, readFileSync(p, 'utf8')))

    expect(found).toEqual([])
  })

  test('no loose menu or command labels', () => {
    const found = files.flatMap((p) => looseLabels(p, readFileSync(p, 'utf8')))
    expect(found).toEqual([])
  })
})
