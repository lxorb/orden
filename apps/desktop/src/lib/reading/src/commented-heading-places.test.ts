import { renderMarkdown } from '@orden/markdown'
import { expect, test } from 'vitest'
import { headingOffsets } from './places'

function drawnHeadings(note: string): number {
  return [...renderMarkdown(note).matchAll(/<h[1-6][ >]/g)].length
}
test('a heading inside a %% comment is not drawn, so it is not counted for the reading place', () => {
  const note = '# Trip\n\nDay one\n\n%%\n## Old plan\nskip\n%%\n\n# Home\n\nRest\n'
  expect(drawnHeadings(note)).toBe(2)
  expect(headingOffsets(note)).toEqual([0, note.indexOf('# Home')])
})
test('a heading inside an HTML comment is not counted either', () => {
  const note = '# Trip\n\nDay one\n\n<!--\n## Old plan\n-->\n\n# Home\n\nRest\n'
  expect(drawnHeadings(note)).toBe(2)
  expect(headingOffsets(note)).toEqual([0, note.indexOf('# Home')])
})
