import { describe, expect, test } from 'vitest'
import { locate, placesOf, type Piece } from './find'

describe('every place a word appears', () => {
  const text = 'The word, and the word again, and a wordy one.'

  test('is found however it was capitalised', () => {
    expect(placesOf(text, 'word')).toEqual([4, 18, 36])
    expect(placesOf(text, 'WORD')).toEqual([4, 18, 36])
    expect(placesOf(text, 'The')).toEqual([0, 14])
  })

  test('includes one inside a longer word, which is what a find bar does', () => {
    expect(placesOf('a wordy word', 'word')).toEqual([2, 8])
  })

  test('overlaps count, since each is a place a reader can be taken to', () => {
    expect(placesOf('aaaa', 'aa')).toEqual([0, 1, 2])
  })

  test('is nothing at all for an empty query', () => {
    expect(placesOf(text, '')).toEqual([])
  })

  test('is nothing when the word is not there', () => {
    expect(placesOf(text, 'sentence')).toEqual([])
  })
})

/** The nodes are only ever looked at through `at`, so a stand-in that carries
 *  nothing but the offset is enough to test the arithmetic. */
function pieces(...offsets: number[]): Piece[] {
  return offsets.map((at) => ({ node: { at } as unknown as Text, at }))
}

describe('which piece of the page an offset falls in', () => {
  const parts = pieces(0, 10, 25, 40)

  test('the one that starts at or before it', () => {
    expect(locate(parts, 0)).toMatchObject({ into: 0, piece: { at: 0 } })
    expect(locate(parts, 9)).toMatchObject({ into: 9, piece: { at: 0 } })
    expect(locate(parts, 10)).toMatchObject({ into: 0, piece: { at: 10 } })
    expect(locate(parts, 24)).toMatchObject({ into: 14, piece: { at: 10 } })
    expect(locate(parts, 41)).toMatchObject({ into: 1, piece: { at: 40 } })
  })

  test('nothing, when the page has no words', () => {
    expect(locate([], 0)).toBeNull()
  })

  test('the first piece, for an offset before it - which nothing asks for', () => {
    expect(locate(pieces(5), 2)).toBeNull()
  })
})
