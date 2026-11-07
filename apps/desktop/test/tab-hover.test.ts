import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const TABS = readFileSync(join(import.meta.dirname, '../src/lib/Tabs.svelte'), 'utf8')

function rule(selector: string): string {
  const at = TABS.indexOf(`\n  ${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return TABS.slice(at, TABS.indexOf('}', at))
}

test('a hovered tab lights in a box as far from the bar as from the top', () => {
  const inset = (one: string) => /inset: ([^;]+);/.exec(one)?.[1]
  expect(inset(rule('.tab::before'))).toBe('var(--tab-top) 3px')
  expect(inset(rule('.fill'))).toBe('var(--tab-top) 3px 0')
  expect(rule('.tab::before')).toMatch(/border-radius: var\(--round\);/)
})

test('what a tab says sits in the middle of that box', () => {
  expect(rule('.pick')).toMatch(/padding: var\(--tab-top\) 8px;/)
  for (const one of ['.shut', '.tab::after']) {
    expect(rule(one), one).toMatch(/top: calc\(50% - 8px\);/)
  }
  expect(rule('.new')).toMatch(/top: calc\(50% - var\(--row-height\) \/ 2\);/)
  expect(TABS).not.toMatch(/50% \+ var\(--tab-top\)/)
})

test('the hover is a tone past the frame, not a step toward the paper', () => {
  expect(rule('.tabs')).toMatch(
    /--tab-hover: var\(--glass-tab-hover, color-mix\(in srgb, var\(--text\)/,
  )
  expect(rule('.tabs')).not.toMatch(/--tab-hover:[^;]*--tab-ground/)
})

test('everything on the frame lights the same under the pointer', () => {
  for (const one of ['.new:hover', '.step:hover:not(:disabled)', '.link:hover']) {
    expect(rule(one), one).toMatch(/background: var\(--tab-hover\);/)
  }
})
