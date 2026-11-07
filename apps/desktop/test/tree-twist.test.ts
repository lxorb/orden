import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('the strip', () => {
  const css = readFileSync(join(import.meta.dirname, '../src/lib/Tree.svelte'), 'utf8')

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
  const css = readFileSync(join(import.meta.dirname, '../src/lib/TagTree.svelte'), 'utf8')

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
