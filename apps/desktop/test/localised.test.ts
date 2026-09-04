import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every string a person can read has to come from `t()`, or the app is only
 *  translated where somebody remembered to translate it. This walks the source
 *  and fails on any that does not. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SKIP = new Set(['node_modules', 'dist', 'target', '.git', 'gen', 'locales'])

/** Attributes a screen reader or a tooltip shows. */
const SPOKEN = ['title', 'aria-label', 'placeholder', 'alt']

/** Dashes and the multiplication sign, spelled by code point so this file does
 *  not trip the check that forbids an em dash in the source. */
const MARKS = [0x2014, 0x2013, 0x00d7, 0x00b7].map((one) => String.fromCharCode(one)).join('')

/** Text that is not prose: shortcuts, examples, technical values, and marks. */
const EXEMPT = [
  new RegExp(`^[\\s\\d.,:;!?/|<>${MARKS}-]*$`), // punctuation and numbers only
  /^(Ctrl|Alt|Shift|Cmd|Meta|F\d)\b/, // keyboard hints
  /^[a-z0-9-]+$/, // identifiers and css-ish values
  /^\{/, // an expression, already dynamic
  /@example\.com$/, // sample addresses
  /^notes\.example\.com$/,
  /^your-name$/,
  /^\.?nibeditor\.com$/,
  /^(B|I|S|M|H|<>|#|"|×)$/, // the format bar's single-glyph labels
  /^(A3|A4|A5|Letter|Legal|PDF|HTML|MCP|LLM|CSS|Nib|DNS|JSON)$/,
  // Product and file-format names, which read the same in every language.
  /^(Word|OpenOffice|RTF|ePub|LaTeX|MediaWiki|reStructuredText|Textile|OPML)$/,
  /^(Claude|ChatGPT|OAuth)$/,
]

const exempt = (text: string) => EXEMPT.some((pattern) => pattern.test(text.trim()))

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue

    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) found.push(path)
  }

  return found
}

/** A `.svelte` file with its `<script>` and `<style>` blocks blanked out, so
 *  only what the reader sees is left. */
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

/** Words sitting straight in the markup, outside any expression. */
function loosePhrases(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const match of body.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].trim()
    // Needs at least one letter and one word to be prose worth translating.
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: relative(path), text })
  }

  return found
}

/** Attributes a person reads, given a bare string instead of `t(...)`. */
function looseAttributes(path: string, source: string): Finding[] {
  const found: Finding[] = []
  const body = template(source)

  for (const name of SPOKEN) {
    for (const match of body.matchAll(new RegExp(`\\b${name}="([^"{}]+)"`, 'g'))) {
      const text = match[1].trim()
      if (!/[A-Za-z]/.test(text) || exempt(text)) continue

      found.push({ where: `${relative(path)} (${name})`, text })
    }
  }

  return found
}

/** Menu and command labels, which are built in TypeScript rather than markup. */
function looseLabels(path: string, source: string): Finding[] {
  const found: Finding[] = []

  for (const match of source.matchAll(/\blabel:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const text = match[2].trim()
    if (!/[A-Za-z]/.test(text) || exempt(text)) continue

    found.push({ where: `${relative(path)} (label)`, text })
  }

  return found
}

describe('everything the reader sees is translated', () => {
  const files = sources(ROOT)

  test('no loose phrases in the markup', () => {
    const found = files.filter((p) => p.endsWith('.svelte')).flatMap((p) => loosePhrases(p, readFileSync(p, 'utf8')))
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
