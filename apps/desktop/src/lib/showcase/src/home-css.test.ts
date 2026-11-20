import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const HOME = readFileSync(new URL('./home.css', import.meta.url), 'utf8')
const BASE = readFileSync(new URL('../../../../../../packages/themes/src/base.css', import.meta.url), 'utf8')
function selectorsOf(css: string): string[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\([^()]*\)/g, (inside) => inside.replace(/,/g, ';'))
  return [...plain.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)]
    .flatMap((found) => (found[1] ?? '').split(','))
    .map((one) => one.replace(/\s+/g, ' ').trim())
    .filter((one) => one !== '' && !/^(?:from|to|\d+%)$/.test(one))
}
describe('the home page styles', () => {
  test('never restate a selector of the app base styles, so no bundle order decides between them', () => {
    const base = new Set(selectorsOf(BASE))
    expect(base.has('html')).toBe(true)
    expect(selectorsOf(HOME).filter((one) => base.has(one))).toEqual([])
  })
  test('free html and body to scroll with selectors that outrank the base styles', () => {
    const home = selectorsOf(HOME)
    expect(home.filter((one) => /^(?:html|body)$/.test(one))).toEqual([])
    expect(home).toContain('html:root')
    expect(home).toContain(':root > body')
    expect(HOME).toMatch(/html:root,\s*:root > body \{[^}]*height: auto;[^}]*overflow: visible;/)
  })
  test('set their words in the Geist they ship, before any fallback', () => {
    expect(HOME).toMatch(/html:root \{[^}]*--font-ui: 'Geist Variable', 'Geist',/)
  })
})
