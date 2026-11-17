import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'

vi.mock('../../link-index/src/api', () => ({
  links: { spaceOf: () => null, targetOf: () => null, embedNote: () => Promise.resolve(null) },
  notePicture: (src: string) => src,
  queryRowsHtml: () => Promise.resolve(null),
}))

vi.mock('../../workspace/src/api', () => ({ keptCoverOf: () => null }))

vi.stubGlobal('__EVEN_PLUGIN__', false)

const { readingHtml } = await import('./render')

const SHEET = join(import.meta.dirname, '../../../../../../packages/themes/src/base.css')
const READING = join(import.meta.dirname, 'Reading.svelte')

function outsideMedia(css: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const media = css.indexOf('@media', at)
    if (media === -1) return out + css.slice(at)
    out += css.slice(at, media)
    let depth = 0
    let end = css.indexOf('{', media)
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      if (css[end] === '}' && --depth === 0) break
    }
    at = end + 1
  }
}

const rules = [
  ...outsideMedia(readFileSync(SHEET, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  ),
].map(([, selectors = '', body = '']) => ({
  selectors: selectors
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean),
  body,
}))

const scrollsSideways = (body: string) => /overflow(-x)?\s*:\s*(auto|scroll)/.test(body)

const wide = `| ${Array.from({ length: 12 }, (_, at) => `Column ${String(at)}`).join(' | ')} |
| ${Array.from({ length: 12 }, () => '---').join(' | ')} |
| ${Array.from({ length: 12 }, () => 'https://example.com/a/very/long/address/that/cannot/wrap').join(' | ')} |
`

test('the reading view clips its sides, so a page block wider than the measure must scroll itself', () => {
  expect(readFileSync(READING, 'utf8')).toMatch(/\.scroller\s*\{[^}]*overflow-x:\s*hidden/)
  const pre = rules.filter((rule) => rule.selectors.includes('#write pre'))
  expect(pre.some((rule) => scrollsSideways(rule.body))).toBe(true)
})

test('a table wider than the reading view can be scrolled sideways at any window width', async () => {
  const html = await readingHtml({ text: wide, path: '/space/Wide.md' }, 'light', true)
  expect(html).toContain('<table>')
  const holders = [
    '#write table',
    ...[...html.matchAll(/<div class="([^"]+)">\s*<table/g)].flatMap(([, names = '']) =>
      names.split(/\s+/).map((name) => `#write .${name}`),
    ),
  ]
  const scrolling = rules.filter(
    (rule) => rule.selectors.some((one) => holders.includes(one)) && scrollsSideways(rule.body),
  )
  expect(scrolling).not.toEqual([])
})
