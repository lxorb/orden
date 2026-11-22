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
  test('give Try it out a visible edge and light the window in the icon colours in both themes', () => {
    expect(HOME).toMatch(/\.orden-button\.is-soft\.is-big \{[^}]*box-shadow: inset 0 0 0 1px/)
    for (const theme of [/html:root \{[^}]*\}/, /html:root\[data-theme='light'\] \{[^}]*\}/]) {
      const block = theme.exec(HOME)?.[0] ?? ''
      for (const one of ['--glow-sky', '--glow-lilac', '--glow-rose']) expect(block, one).toContain(one)
    }
    expect(HOME).not.toMatch(/radial-gradient\([^)]*rgb\(\d/)
  })
  test('end on two big buttons side by side on a wide screen and of one width on a phone', () => {
    expect(HOME).toMatch(/\.coda-actions \{[^}]*width: 100%;/)
    expect(HOME).toMatch(/\.coda \.orden-button\.is-big \{[^}]*min-height: clamp\(64px/)
    expect(HOME).toMatch(
      /@media \(max-width: 719\.98px\) \{[\s\S]*\.coda \.orden-button\.is-big \{\s*width: min\(340px, 100%\);/,
    )
  })
  test('give each display a screen of exactly the demo window shape, so poster and live frame line up', () => {
    expect(HOME).toMatch(/\.display \{[^}]*box-sizing: content-box;[^}]*aspect-ratio: 1280 \/ 800;/)
    expect(HOME).toMatch(
      /@media \(max-width: 719\.98px\) \{[\s\S]*padding: 10px;\s*aspect-ratio: 390 \/ 844;[\s\S]*\.screen \{\s*inset: 10px;/,
    )
  })
})
