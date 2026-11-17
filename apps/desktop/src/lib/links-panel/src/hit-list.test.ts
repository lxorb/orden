import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8')

describe('the Links panel', () => {
  test('draws a window of each hit list rather than every row it holds', () => {
    const text = source('HitList.svelte')

    expect(text).toContain('windowFor')
    expect(text).toContain('view.above')
    expect(text).toContain('view.below')
    expect(text).toContain('reach')
  })

  test('draws its hit lists through that window', () => {
    const text = source('Links.svelte')

    expect(text).toContain('HitList')
    expect(text).not.toMatch(/\{#each\s+rows\s+as/)
  })
})
