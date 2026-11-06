import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SURFACE = /\.surface \{([^}]*)\}/.exec(
  readFileSync(fileURLToPath(new URL('./Editor.svelte', import.meta.url)), 'utf8'),
)?.[1]

describe('the pane the editor is in', () => {
  test('gives it a height to be a hundred percent of', () => {
    expect(SURFACE).toBeDefined()
    expect(SURFACE).toMatch(/flex:\s*1/)
    expect(SURFACE).toMatch(/min-height:\s*0/)
  })

  test('clips what overflows it, so nothing but the scroller scrolls', () => {
    expect(SURFACE).toMatch(/overflow:\s*hidden/)
  })
})
