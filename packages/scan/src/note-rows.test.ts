import { expect, test } from 'vitest'
import { noteRowsOf } from './note-rows'

test('a note’s rows carry the tags of its front matter beside its inline ones', () => {
  const [row] = noteRowsOf('S', 'Books/Emma.md', '---\ntags: [book, Reading]\n---\nBody #shelf\n')
  expect(row?.file.tags).toEqual(['book', 'reading', 'shelf'])
})
