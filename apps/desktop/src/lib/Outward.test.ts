import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import Outward from './Outward.svelte'

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), { encoding: 'utf8' })

const LIB = fileURLToPath(new URL('.', import.meta.url))
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((one) =>
    one.isDirectory()
      ? sources(join(dir, one.name))
      : one.name.endsWith('.svelte')
        ? [join(dir, one.name)]
        : [],
  )
const components = sources(LIB).map((path) => ({
  path: path.slice(LIB.length),
  text: readFileSync(path, { encoding: 'utf8' }),
}))

const rule = (css: string, selector: string) => {
  const at = css.lastIndexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('the arrow', () => {
  const body = render(Outward).body

  test('is the shared mark, glued to the word before it', () => {
    expect(body).toContain('nib-mark')
    expect(body).toContain('⁠<svg')
  })

  test('points along the line, and is turned over the other way', () => {
    expect(body).toMatch(/<svg class="nib-mirror\b/)
    expect(body).toContain('d="M6 3h7v7M13 3L5 11"')
  })

  test('is a drawing a screen reader passes over: the link says where it goes', () => {
    expect(body).toContain('aria-hidden="true"')
  })
})

describe('every link that leaves the app', () => {
  test('carries the one arrow, not a drawing or a character of its own', () => {
    for (const one of components) {
      if (one.path === 'Outward.svelte') continue
      expect(one.text, one.path).not.toContain('M6 3h7v7M13 3L5 11')
      expect(one.text, one.path).not.toMatch(/↗/)
    }
    expect(components.filter((one) => one.text.includes('<Outward />')).length).toBeGreaterThan(2)
  })

  test('writes it straight after the last word: a space there would widen the gap', () => {
    for (const one of components) {
      expect(one.text, one.path).not.toMatch(/\s<Outward\b/)
    }
  })

  test('is a run of text that leaves the end of its line to the mark', () => {
    for (const one of [
      rule(read('./SettingsPanel.svelte'), '.hint.caption .link'),
      rule(read('./access/AccountSteps.svelte'), '.link'),
      rule(read('./terminal/TerminalTab.svelte'), '.bar .words'),
    ]) {
      expect(one).not.toMatch(/display: (inline-)?flex|align-items|gap:/)
      expect(one).not.toMatch(/padding(-inline)?(-end)?:/)
    }
  })
})

describe('the mark', () => {
  const base = read('../../../../packages/themes/src/base.css')

  test('sits on the middle of the letters, and takes no room on the line', () => {
    const glyph = rule(base, '.nib-mark > :first-child')
    expect(glyph).toContain('vertical-align: middle')
    expect(glyph).toContain('margin-inline-start: calc(-1 * var(--mark-size, 16px))')
    expect(rule(base, '.nib-mark')).toContain('white-space: nowrap')
    expect(rule(base, ':has(> .nib-mark)')).toContain('padding-inline-end')
  })

  test('is what the `?` and the arrow are, with no placing of their own', () => {
    for (const path of ['./Hint.svelte', './Outward.svelte']) {
      const text = read(path)
      expect(text, path).toMatch(/class="[^"]*\bnib-mark\b/)
      expect(text, path).not.toMatch(/vertical-align|margin-inline-start/)
    }
  })
})
