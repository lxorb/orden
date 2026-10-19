import { describe, expect, test } from 'vitest'
import { pageSheet } from './page-sheet'

/** A theme on a published page, which follows the reader's system until they press
 *  the button in its bar, and never says so with `data-theme` while it does. */

const light = 'color-scheme: light; --bg: #faf6ee;'
const dark = 'color-scheme: dark; --bg: #1c1814;'

describe('a theme on a published page', () => {
  test('a pair is stacked the way the page stacks its own tokens', () => {
    const sheet = pageSheet(
      `/* a comment */\n[data-theme='light'] { ${light} }\n[data-theme="dark"] { ${dark} }`,
    )

    expect(sheet.split('\n')).toEqual([
      `:root { ${light} }`,
      `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ${dark} } }`,
      `:root[data-theme='dark'] { ${dark} }`,
      `:root[data-theme='light'] { ${light} }`,
      `@media print { :root, :root[data-theme='dark'] { ${light} } }`,
    ])
  })

  test('one side is that side, and the other is the page its own', () => {
    const sheet = pageSheet(`[data-theme = 'light'] { ${light} }`)

    expect(sheet).toContain(`:root { ${light} }`)
    expect(sheet).toContain(`:root[data-theme='light'] { ${light} }`)
    expect(sheet).not.toContain('prefers-color-scheme')
    expect(sheet).not.toContain(":root:not([data-theme='light'])")
  })

  test('the shared block and the prose rules go as they were', () => {
    const sheet = pageSheet(
      ":root { --font-content: 'Semi; colon', serif; }\n#write blockquote { font-style: italic; }",
    )

    expect(sheet).toBe(
      ":root { --font-content: 'Semi; colon', serif; }\n#write blockquote { font-style: italic; }",
    )
  })

  test('a block stated for both sides lands on both', () => {
    const sheet = pageSheet(`[data-theme='light'], [data-theme='dark'] { --radius-md: 4px; }`)

    expect(sheet).toContain(':root { --radius-md: 4px; }')
    expect(sheet).toContain(":root[data-theme='dark'] { --radius-md: 4px; }")
  })
})
