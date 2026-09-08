import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** How wide a tab is comes out of the flex algorithm, so the rule lives in the
 *  stylesheet rather than in a function a test could call. This reads the rule
 *  back out of it.
 *
 *  What it is guarding: the strip used to ask for a share of the titlebar
 *  rather than for the room its tabs needed, and each tab was capped well under
 *  that share, so names were cut with half the bar standing empty. */

const strip = readFileSync(
  fileURLToPath(new URL('../src/lib/Tabs.svelte', import.meta.url)),
  'utf8',
)
const tokens = readFileSync(
  fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)

/** Every rule in the component's stylesheet, as the selectors it is written for
 *  and the declarations it makes. Comments go first: they hold colons and
 *  semicolons of their own and would otherwise read as CSS. */
const RULES = [
  ...[...strip.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((one) => one[1] ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selectors = '', body = '']) => ({
  selectors: selectors.split(',').map((one) => one.trim().replace(/\s+/g, ' ')),
  body,
}))

/** Everything the stylesheet says about exactly this selector. */
function declarations(selector: string): string {
  const found = RULES.filter((rule) => rule.selectors.includes(selector))
  expect(found.length, `nothing styles ${selector}`).toBeGreaterThan(0)

  return found.map((rule) => rule.body).join('\n')
}

/** What this selector is given for a property, or null where it is left alone.
 *  The last one wins, as it does in the browser. */
function value(selector: string, property: string): string | null {
  const given = [...declarations(selector).matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].filter(
    ([, name]) => name === property,
  )

  return given.at(-1)?.[2]?.trim() ?? null
}

describe('a tab is as wide as the room and its name allow', () => {
  test('the strip asks for what its tabs need, not for a share of the row', () => {
    // `flex: 1` is `1 1 0%`, a basis of nothing. Beside the titlebar's drag
    // region, which grows just as hard, that split the row in two and left the
    // strip scrolling with the other half empty.
    expect(value('.strip', 'flex')).toBe('1 1 auto')
    expect(value('.tabs', 'flex')).toBe('1 1 auto')
  })

  test('a tab grows to its name and gives way only once the strip is full', () => {
    expect(value('.tab', 'flex')).toMatch(/^0 [1-9]\d* auto$/)
    expect(value('.tab', 'min-width')).toBe('var(--tab-min)')
    expect(value('.label', 'max-width')).toBe('var(--tab-name)')
  })

  test('nothing but the name caps a tab', () => {
    // A cap anywhere else is a cap the tab cannot grow past however much room
    // the strip has, which is the bug this file is named after.
    for (const selector of ['.strip', '.tabs', '.tab', '.pick']) {
      expect(value(selector, 'max-width'), `${selector} caps the tab`).toBeNull()
    }
  })

  test('the tab being read is the last one to give way', () => {
    const others = Number(value('.tab', 'flex')?.split(/\s+/)[1])
    expect(Number(value('.tab.active', 'flex-shrink'))).toBeLessThan(others)
  })

  test('the name is what shortens, and it says so', () => {
    // A flex item will not shrink under its content unless it is told it may.
    expect(value('.pick', 'min-width')).toBe('0')
    expect(value('.label', 'min-width')).toBe('0')
    expect(value('.label', 'text-overflow')).toBe('ellipsis')
  })

  test('the ellipsis is not asked of a flex box', () => {
    // A flex container draws none: the text in it is an anonymous item, and
    // the name was being cut through the middle of a letter instead.
    const offenders = RULES.filter((rule) => /text-overflow:\s*ellipsis/.test(rule.body))
      .flatMap((rule) => rule.selectors)
      .filter((selector) => /^(flex|inline-flex)$/.test(value(selector, 'display') ?? ''))

    expect(offenders, `these would draw no ellipsis: ${offenders.join(', ')}`).toEqual([])
  })

  test('the close control keeps its size while the name shrinks', () => {
    expect(value('.shut', 'flex')).toBe('none')
  })

  test('the two widths are tokens, and the tokens are there', () => {
    expect(tokens).toMatch(/--tab-name:\s*\d+px;/)
    expect(tokens).toMatch(/--tab-min:\s*\d+px;/)
  })
})
