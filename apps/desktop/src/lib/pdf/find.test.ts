import { describe, expect, test } from 'vitest'
import { locate, placesOf } from '../reading/find'
import { runsOfItems, textOfRuns, wordsOfRuns } from './find'

function divs(...runs: (string | null)[]): HTMLElement[] {
  return runs.map(
    (run) =>
      ({
        firstChild: run === null ? null : { nodeType: 3, data: run },
      }) as unknown as HTMLElement,
  )
}

describe("a page's words", () => {
  test('are its runs, joined', () => {
    expect(textOfRuns(['The ', 'word', ' again'])).toBe('The word again')
    expect(textOfRuns([])).toBe('')
  })

  test('and a match may run across two of them, which is why they are joined', () => {
    expect(placesOf(textOfRuns(['the wo', 'rd here']), 'word')).toEqual([4])
  })
})

describe("a page's runs, read from the PDF", () => {
  const items = [
    { str: 'the end of a field.', hasEOL: true },
    { type: 'beginMarkedContent' },
    { str: 'Line 52', hasEOL: false },
    { type: 'endMarkedContent' },
    { str: '', hasEOL: true },
    { str: 'ends in a space ', hasEOL: true },
    { str: 'last' },
  ]

  test('a line that ends is kept apart from the next by a space', () => {
    expect(textOfRuns(runsOfItems(items))).toBe('the end of a field. Line 52 ends in a space last')
  })

  test('so a match does not run across two lines, and a phrase across them is found', () => {
    const text = textOfRuns(runsOfItems(items))

    expect(placesOf(text, 'field.Line')).toEqual([])
    expect(placesOf(text, 'field. Line')).toEqual([13])
  })

  test('one run per piece of text, as many as the spans the page draws', () => {
    expect(runsOfItems(items)).toHaveLength(5)
  })

  test('and each run starts where its span does, the space after it', () => {
    const runs = runsOfItems(items)
    const words = wordsOfRuns(
      runs,
      divs(...items.flatMap((one) => ('str' in one ? [one.str || null] : []))),
    )

    expect(words.pieces.map((piece) => piece.at)).toEqual([0, 20, 28, 44])
  })
})

describe('where a page keeps its words', () => {
  const runs = ['The ', 'word', ' again']

  test('one piece per run, at the offset that run begins at', () => {
    const words = wordsOfRuns(runs, divs(...runs))

    expect(words.text).toBe('The word again')
    expect(words.pieces.map((piece) => piece.at)).toEqual([0, 4, 8])
  })

  test('so a place found in the words names the node it sits in', () => {
    const words = wordsOfRuns(runs, divs(...runs))
    const [place] = placesOf(words.text, 'again')

    expect(locate(words.pieces, place ?? 0)).toMatchObject({ into: 1, piece: { at: 8 } })
  })

  test('an empty run is nothing to paint, and adds nothing to the words', () => {
    const words = wordsOfRuns(['one', '', 'two'], divs('one', null, 'two'))

    expect(words.text).toBe('onetwo')
    expect(words.pieces.map((piece) => piece.at)).toEqual([0, 3])
  })

  test('a span the page has not laid out yet is left out rather than guessed at', () => {
    const words = wordsOfRuns(runs, divs('The ', null))

    expect(words.text).toBe('The word again')
    expect(words.pieces.map((piece) => piece.at)).toEqual([0])
  })

  test('a page nobody has drawn has words and no pieces', () => {
    const words = wordsOfRuns(runs, [])

    expect(words.text).toBe('The word again')
    expect(words.pieces).toEqual([])
  })
})
