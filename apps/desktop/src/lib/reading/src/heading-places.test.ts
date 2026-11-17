import { renderMarkdown } from '@orden/markdown'
import { expect, test } from 'vitest'
import { headingOffsets } from './places'

function drawnHeadings(note: string): number {
  return [...renderMarkdown(note).matchAll(/<h[1-6][ >]/g)].length
}

test('words right above a rule are not a heading, so the reading view keeps its place', () => {
  const note = '# Trip\n\nDay one was long\n---\n\n# Home\n\nRest\n'
  expect(drawnHeadings(note)).toBe(2)
  expect(headingOffsets(note)).toEqual([0, note.indexOf('# Home')])
})

test('words above a line of equals signs are not a heading either', () => {
  const note = '# Sums\n\n1 + 1\n===\n\n# Next\n'
  expect(drawnHeadings(note)).toBe(2)
  expect(headingOffsets(note)).toEqual([0, note.indexOf('# Next')])
})
