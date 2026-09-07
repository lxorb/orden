import { describe, expect, test } from 'vitest'
import { locate, placesOf } from '../reading/find'
import { textOfRuns, wordsOfRuns } from './find'

/** The spans pdf.js lays a page's runs out in. Only `firstChild` and its
 *  `nodeType` are ever looked at, so a stand-in carrying those is enough to state
 *  the arithmetic without a DOM to build one in. */
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
    // `the **word**` is two runs and one phrase.
    expect(placesOf(textOfRuns(['the wo', 'rd here']), 'word')).toEqual([4])
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
