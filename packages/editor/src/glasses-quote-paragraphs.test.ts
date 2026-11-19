import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { markLines } from '../../glasses/src/mark'

const INNER = 576
describe('a quote of two paragraphs on the glasses', () => {
  test('numbers the lines after the bare > line by where they are in the note', () => {
    const note = '> first\n>\n> second\n> third\n\nend'
    expect(markLines(note, { inner: INNER }).map((line) => line.at)).toEqual([1, 3, 4, 6])
  })
  test('places the second paragraph where it starts, not after the quote', () => {
    const note = '> first\n>\n> second\n> third\n\nend'
    const second = markLines(note, { inner: INNER }).find((line) => line.text.includes('second'))
    expect(second?.from).toBe(note.indexOf('second'))
  })
  test('numbers the later paragraphs of a callout by their own lines', () => {
    const note = '> [!note] Trip\n> Pack the bags\n>\n> Book the hotel\n>\n> Call the bank\n\nend'
    const marked = markLines(note, { inner: INNER })
    const atOf = (words: string) => marked.find((line) => line.text.includes(words))?.at
    expect([atOf('Book the hotel'), atOf('Call the bank'), atOf('end')]).toEqual([4, 6, 8])
  })
})
