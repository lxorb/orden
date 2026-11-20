import { describe, expect, test } from 'vitest'
import { shownName } from './note-name'
import { shownPath, stemOf } from './shown'

describe('a path as a reader is shown it', () => {
  test("keeps its folders and drops only Orden's own ending from its last name", () => {
    expect(shownPath('Notes/Board.canvas')).toBe('Notes/Board')
    expect(shownPath('/s/Plans/Journal.pages')).toBe('/s/Plans/Journal')
    expect(shownPath('C:\\Notes\\Plan.md')).toBe('C:\\Notes\\Plan')
    expect(shownPath('Terminal.term')).toBe('Terminal')
    expect(shownPath('a/X.pdf')).toBe('a/X.pdf')
    expect(shownPath('Old.chat/Readme.txt')).toBe('Old.chat/Readme.txt')
    expect(shownPath('Notes/.md')).toBe('Notes/.md')
  })
  test('is the name as shown when it has no folder', () => {
    for (const name of ['Plan.md', 'Site.url', 'Bugs.base', 'paper.pdf']) expect(shownPath(name)).toBe(shownName(name))
  })
})
describe('the stem of a name', () => {
  test("is the name without an ending that has a letter in it, Orden's own or a file's", () => {
    expect(stemOf('Board.canvas')).toBe('Board')
    expect(stemOf('notes.mp3')).toBe('notes')
    expect(stemOf('a.7z')).toBe('a')
    expect(stemOf('Plan.v2.txt')).toBe('Plan.v2')
  })
  test('keeps a name whose last part is a number, a folder, or a dotfile', () => {
    for (const name of ['v1.2', 'Report 2024.10', 'my.folder/README', 'a.b\\c', '.env', 'a/.env', 'Readme']) {
      expect(stemOf(name)).toBe(name)
    }
  })
})
