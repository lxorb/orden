import { SOURCES, sourceOf } from '@orden/pass/import/index'
import { expect, test } from 'vitest'
import { kindsOf, markOf, stepsOf } from './import-sources'

test('every password manager Pass reads has its mark, its file kinds and how to export from it', () => {
  expect(SOURCES.length).toBe(19)
  for (const one of SOURCES) {
    const mark = markOf(one.id)
    expect(mark.letters.length, one.id).toBeGreaterThan(0)
    expect(mark.letters.length, one.id).toBeLessThanOrEqual(3)
    expect(mark.fill, one.id).toMatch(/^#[0-9a-f]{6}$/)
    expect(kindsOf(one), one.id).toBe(one.accept.map((kind) => kind.slice(1)).join(', '))
    const steps = stepsOf(one)
    expect(steps, one.id).not.toMatch(/\{\w+\}/)
    if (one.id !== 'csv') expect(steps, one.id).toContain(one.name)
  }
  expect(kindsOf(sourceOf('onepassword'))).toBe('1pux, 1pif, csv')
})
