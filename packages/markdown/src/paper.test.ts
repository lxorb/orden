import { describe, expect, test } from 'vitest'
import { holderOf, pairOf, paperOf } from './links'

describe("a page note's paper", () => {
  test('is the note with .pdf after it, and leads back to the note', () => {
    expect(paperOf('/s/Plan.pages')).toBe('/s/Plan.pages.pdf')
    expect(holderOf('/s/Plan.pages.pdf')).toBe('/s/Plan.pages')
    expect(holderOf('/s/Plan.pdf')).toBeNull()
    expect(pairOf('/s/Plan.pages')).toBe('/s/Plan.pages.pdf')
    expect(pairOf('/s/Plan.pages.pdf')).toBe('/s/Plan.pages')
    expect(pairOf('/s/Plan.md')).toBeNull()
  })
})
