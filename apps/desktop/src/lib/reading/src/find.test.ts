import { afterEach, describe, expect, test, vi } from 'vitest'
import { locate, placesIn, placesOf, type Piece, type Words } from '@orden/scan/search/find'
import { paint } from './find'

const text = 'The word, and the word again, and a wordy one.'

describe('every place a word appears', () => {
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

  test('stays where the words are after a letter that lowercases into two', () => {
    expect(placesOf('İstanbul beta', 'beta')).toEqual([9])
    expect(placesIn({ text: 'İİ beta İ beta', pieces: [] }, 'BETA')).toEqual([3, 10])
  })
})

describe('the same over a page read once', () => {
  test('answers what asking the text itself would', () => {
    const words: Words = { text, pieces: [] }
    expect(placesIn(words, 'WORD')).toEqual(placesOf(text, 'word'))
    expect(placesIn(words, '')).toEqual([])
  })

  test('folds the page once, however many letters are typed after it', () => {
    const words: Words = { text, pieces: [] }
    expect(words.folded).toBeUndefined()

    placesIn(words, 'wo')
    const first = words.folded
    placesIn(words, 'wor')

    expect(first).toBe(text.toLowerCase())
    expect(words.folded).toBe(first)
  })
})

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

describe('painting the places found', () => {
  class Highlight {
    readonly ranges: Range[]
    constructor(...ranges: Range[]) {
      this.ranges = ranges
    }
  }
  const highlights = new Map<string, Highlight>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', Highlight)

  afterEach(() => highlights.clear())

  const range = (at: number) => ({ at }) as unknown as Range
  const painted = (name: string) => highlights.get(name)?.ranges ?? []

  test("one page's paint leaves another page's in place", () => {
    const left = {}
    const right = {}

    paint(left, 'orden-find', [range(1), range(2)])
    paint(right, 'orden-find', [range(3)])
    expect(painted('orden-find')).toEqual([range(1), range(2), range(3)])

    paint(right, 'orden-find', [])
    expect(painted('orden-find')).toEqual([range(1), range(2)])

    paint(left, 'orden-find', [])
    expect(highlights.has('orden-find')).toBe(false)
  })

  test('a page painting again replaces only its own', () => {
    const left = {}
    const right = {}

    paint(left, 'orden-find', [range(1)])
    paint(right, 'orden-find', [range(2)])
    paint(left, 'orden-find', [range(4)])
    expect(painted('orden-find')).toHaveLength(2)
    expect(painted('orden-find')).toEqual(expect.arrayContaining([range(2), range(4)]))
  })
})
