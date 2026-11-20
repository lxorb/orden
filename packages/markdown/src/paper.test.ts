import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { holderOf, pairOf, paperOf } from './paper'

describe("a page note's paper", () => {
  test('is the note with .pdf after it, and leads back to the note', () => {
    expect(paperOf('/s/Plan.pages')).toBe('/s/Plan.pages.pdf')
    expect(holderOf('/s/Plan.pages.pdf')).toBe('/s/Plan.pages')
    expect(holderOf('/s/Plan.pdf')).toBeNull()
    expect(pairOf('/s/Plan.pages')).toBe('/s/Plan.pages.pdf')
    expect(pairOf('/s/Plan.pages.pdf')).toBe('/s/Plan.pages')
    expect(pairOf('/s/Plan.md')).toBeNull()
  })
  test('is named without the page engine, so the first paint can ask for it', () => {
    expect(readFileSync(join(import.meta.dirname, 'paper.ts'), 'utf8')).not.toMatch(/^import /m)
  })
})
