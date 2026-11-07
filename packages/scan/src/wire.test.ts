import { describe, expect, test } from 'vitest'
import { indexed } from './indexed'
import { parseQuery } from './search/query'
import { indexAnswerOf, indexRequestOf, queryOf, searchAnswerOf, searchRequestOf } from './wire'

const QUERIES = [
  'garden',
  '"a phrase" -not OR other',
  '(a OR b) c',
  'path:Projects file:Plan tag:work content:orden',
  '/gard(en)?/i case: Word',
  'line:(a b) block:(c d) section:(e f)',
  'task-todo: task-done:(x) task:(y)',
  '[status] [status:draft] [pages:<200] [due:>2026-09-01] [pages:100..200] [gone:null]',
]

describe('a query crossing to the account', () => {
  test('reads back as the query the field parsed, every shape of it', () => {
    for (const text of QUERIES) {
      const query = parseQuery(text)
      expect(queryOf(JSON.parse(JSON.stringify(query)) as unknown), text).toEqual(query)
    }
  })

  test('is refused where it is not one', () => {
    expect(queryOf({ kind: 'nonsense' })).toBeNull()
    expect(queryOf({ kind: 'all', of: [{ kind: 'text', text: 1, fold: true }] })).toBeNull()
    let deep: unknown = { kind: 'text', text: 'a', fold: true }
    for (let at = 0; at < 40; at += 1) deep = { kind: 'not', of: deep }
    expect(queryOf(deep)).toBeNull()
  })

  test('with its terms, limit and page', () => {
    const query = parseQuery('garden')
    expect(
      searchRequestOf({ query, terms: ['garden'], limit: 24, after: 'n1', skip: ['n2'] }),
    ).toEqual({ query, terms: ['garden'], limit: 24, after: 'n1', skip: ['n2'] })
    expect(searchRequestOf({ query, terms: [], limit: 0 })).toBeNull()
    expect(searchRequestOf({ query, terms: [], limit: 201 })).toBeNull()
  })
})

describe('an index answer', () => {
  test('reads back every kind of scan the index makes', () => {
    const stamp = { size: 1, mtime: 2, ctime: 3 }
    const scans = [
      indexed('Plans.md', '---\nstatus: draft\n---\n# Plans\n[[Ideas]] #work\n- [ ] task\n', stamp),
      indexed(
        'Board.canvas',
        '{"nodes":[{"id":"a","type":"file","file":"P.md","x":0,"y":0,"width":1,"height":1}]}',
        stamp,
      ),
      indexed('Site.url', '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n', stamp),
    ]
    const items = scans.map((scan, at) => ({ id: `n${String(at)}`, docSeq: at, scan }))
    expect(indexAnswerOf(JSON.parse(JSON.stringify({ items })) as unknown)).toEqual(items)
  })

  test('leaves out an item that does not read, and keeps the rest', () => {
    const items = [
      { id: 'a', refused: 'gone' },
      { id: 'b', docSeq: 1, scan: null },
      { id: 'c', docSeq: 1, scan: { path: 'x' } },
    ]
    expect(indexAnswerOf({ items })).toEqual(items.slice(0, 2))
    expect(indexRequestOf({ ids: ['a'] })).toEqual({ ids: ['a'] })
    expect(indexRequestOf({ ids: [''] })).toBeNull()
  })

  test('and a search answer', () => {
    const hit = {
      id: 'a',
      path: 'P.md',
      name: 'P.md',
      line: 0,
      text: 'x',
      ranges: [{ from: 0, to: 1 }],
    }
    expect(searchAnswerOf({ hits: [hit], loose: [{ ...hit, score: 2 }], after: null })).toEqual({
      hits: [hit],
      loose: [{ ...hit, score: 2 }],
      after: null,
    })
    expect(searchAnswerOf({ hits: [hit], loose: [hit], after: null })).toBeNull()
  })
})
