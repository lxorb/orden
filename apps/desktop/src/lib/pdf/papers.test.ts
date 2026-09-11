import { beforeEach, describe, expect, test } from 'vitest'
import { forgetPapers, paperGone, paperRead, papersRead, searchPapers } from './papers'
import { parseQuery } from '../search/query'

/** Searching the papers that have been read.
 *
 *  A page's words arrive as pdf.js hands them over - a list of runs, one per span
 *  it drew - and a row is a window on the page rather than a line of it, because a
 *  page has no lines. */

const ROOT = '/space'

/** One page, as the viewer would have read it: the words broken into the spans a
 *  PDF is actually drawn in. */
const page = (text: string) => text.split(' ')

const found = (source: string, excluded: readonly string[] = []) =>
  searchPapers(ROOT, parseQuery(source), 20, excluded)

beforeEach(() => {
  forgetPapers()
})

describe('a paper that has been read', () => {
  beforeEach(() => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 1, page('a study of ink on paper and its wear'))
    paperRead(`${ROOT}/papers/Ink.pdf`, 4, page('the kestrel hangs on the wind above the field'))
  })

  test('answers a query about its words', () => {
    const hits = found('kestrel')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.page).toBe(4)
    expect(hits[0]?.name).toBe('Ink.pdf')
    expect(hits[0]?.path).toBe(`${ROOT}/papers/Ink.pdf`)
  })

  test('and the row is the words around the match, with the match in it', () => {
    const [hit] = found('kestrel')
    const range = hit?.ranges[0]

    expect(hit?.text).toContain('kestrel')
    expect(hit?.text.slice(range?.from, range?.to)).toBe('kestrel')
  })

  test('and answers once per page rather than once per word', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 7, page('ink ink ink ink ink'))

    expect(found('ink').map((hit) => hit.page)).toEqual([1, 7])
  })

  test('and its pages come in the order they are in the paper', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 2, page('wind again'))

    expect(found('wind').map((hit) => hit.page)).toEqual([2, 4])
  })

  test('and a run is not joined to the next into a word neither says', () => {
    paperRead(`${ROOT}/papers/Odd.pdf`, 1, ['some', 'thing'])

    expect(found('something')).toEqual([])
    expect(found('some thing')).toHaveLength(1)
  })

  test('and the operators mean what they mean in a note', () => {
    expect(found('file:Ink').map((hit) => hit.page)).toEqual([1, 4])
    expect(found('path:papers').length).toBeGreaterThan(0)
    expect(found('kestrel -wind')).toEqual([])
  })

  test('and a paper the space leaves out answers nothing', () => {
    expect(found('kestrel', ['papers'])).toEqual([])
    expect(found('kestrel', ['papers/Ink.pdf'])).toEqual([])
    expect(found('kestrel', ['paper'])).toHaveLength(1)
  })

  test('and a paper in another space is not this space s to answer', () => {
    paperRead('/elsewhere/Other.pdf', 1, page('kestrel again'))

    expect(found('kestrel').map((hit) => hit.path)).toEqual([`${ROOT}/papers/Ink.pdf`])
  })

  test('and one that has gone answers nothing', () => {
    paperGone(`${ROOT}/papers/Ink.pdf`)

    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })
})

describe('a space where nothing has been read', () => {
  test('answers nothing, and costs nothing to ask', () => {
    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })

  test('and a page with no words in it is not an answer', () => {
    paperRead(`${ROOT}/Blank.pdf`, 1, ['', '  '])

    expect(found('anything')).toEqual([])
  })
})
