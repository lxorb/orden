import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The strip a press on a row's twist lands on (#402), as the file list's stylesheet
 *  says it: the row's whole height, nothing drawn, and a thumb's width where there is
 *  one. Measured on a laid-out page by test/e2e/tree-caret.py. */

describe('the strip', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../src/lib/Tree.svelte', import.meta.url)),
    'utf8',
  )

  test('is the row’s whole height, and drawn nowhere', () => {
    const rule = /\.twist::before \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('inset-block: 0')
    expect(rule).toContain("content: ''")
    expect(rule).not.toMatch(/background|border|color/)
  })

  test('and never narrower than a thumb where there is one', () => {
    expect(css).toMatch(/\[data-touch\]\) \.twist::before \{[^}]*--touch-target/)
  })
})

describe('the tag tree’s twist', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../src/lib/TagTree.svelte', import.meta.url)),
    'utf8',
  )

  test('is pressed a step wider than it is drawn, on the row’s whole height', () => {
    const rule = /\.twist::before \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('inset-block: 0')
    expect(rule).toContain("content: ''")
    expect(rule).not.toMatch(/background|border|color/)
  })

  test('and never narrower than a thumb where there is one', () => {
    expect(css).toMatch(/\[data-touch\]\) \.twist::before \{[^}]*--touch-target/)
  })
})
