import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { toggleWrap } from '../commands'
import { highlightSelection, setHighlightColour } from '../highlight'
import { runInCell } from './shortcuts'

describe('mark shortcuts in a table cell with the caret or a word inside a marked run', () => {
  test('bold with the caret inside a bold word takes the bold off', () => {
    expect(runInCell(toggleWrap('**'), 'a **word** b', 6, 6)?.text).toBe('a word b')
  })

  test('code with the caret inside a code span takes the code off', () => {
    expect(runInCell(toggleWrap('`'), 'a `code` b', 5, 5)?.text).toBe('a code b')
  })

  test('bold over a word picked inside a bold run takes the bold off that word', () => {
    expect(runInCell(toggleWrap('**'), 'a **one two** b', 8, 11)?.text).toBe('a **one** two b')
  })

  test('highlight with the caret inside a highlighted word takes it off', () => {
    const plain = HIGHLIGHT_COLOURS.find((colour) => colour.emoji === null)
    if (plain) setHighlightColour(plain)
    expect(runInCell(highlightSelection, 'a ==lit== b', 5, 5)?.text).toBe('a lit b')
  })
})
