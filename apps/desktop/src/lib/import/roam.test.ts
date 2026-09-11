import { describe, expect, test } from 'vitest'

import type { ImportPlan } from './plan'
import { dayName, readRoam, roamText } from './roam'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (!found || found.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

const GRAPH = JSON.stringify([
  {
    title: 'The plan',
    'create-time': 1767355200000,
    children: [
      {
        string: 'First thought',
        uid: 'abc123',
        children: [{ string: 'Under it', uid: 'def456' }],
      },
      { string: '{{[[TODO]]}} Ring the bank', uid: 'ghi789' },
      { string: 'Bold ^^and lit^^', uid: 'jkl012' },
    ],
  },
  {
    title: 'September 11th, 2026',
    children: [{ string: 'As I said in ((abc123))', uid: 'mno345' }],
  },
])

describe('a Roam export', () => {
  test('a page is a note and its blocks are a nested list', async () => {
    const plan = await readRoam([file('graph.json', GRAPH)])

    const text = noteAt(plan, 'The plan.md')
    expect(text).toContain('- First thought')
    expect(text).toContain('  - Under it')
    expect(text).toContain('date: 2026-01-02')
  })

  test('a checkbox is a task and a highlight is a highlight', async () => {
    const text = noteAt(await readRoam([file('graph.json', GRAPH)]), 'The plan.md')

    expect(text).toContain('- [ ] Ring the bank')
    expect(text).toContain('Bold ==and lit==')
  })

  test('a daily page is the date it is, in a folder of its own', async () => {
    const plan = await readRoam([file('graph.json', GRAPH)])

    expect(plan.files.map((one) => one.path)).toEqual(['The plan.md', 'Journals/2026-09-11.md'])
  })

  test('a block reference is written out as what it said', async () => {
    const plan = await readRoam([file('graph.json', GRAPH)])

    expect(noteAt(plan, 'Journals/2026-09-11.md')).toContain('As I said in First thought')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
  })

  test('a JSON that is not a Roam graph is not read as one', async () => {
    const plan = await readRoam([file('settings.json', '{"theme":"dark"}')])

    expect(plan.files).toHaveLength(0)
  })
})

describe("Roam's own spellings", () => {
  test('an embed is the words it embedded', () => {
    const known = new Map([['abc', 'The words']])

    expect(roamText('{{[[embed]]: ((abc))}}', known)).toBe('The words')
  })

  test('a reference nothing knows is left exactly as written', () => {
    expect(roamText('See ((nope))')).toBe('See ((nope))')
  })

  test('a button loses its braces and keeps its words', () => {
    expect(roamText('{{[[query]]}}')).toBe('query')
  })
})

describe('a day out of a page name', () => {
  test('reads the shape Roam writes', () => {
    expect(dayName('September 11th, 2026')).toBe('2026-09-11')
    expect(dayName('May 1st, 2026')).toBe('2026-05-01')
  })

  test('is nothing for a page somebody named', () => {
    expect(dayName('September plans')).toBeNull()
    expect(dayName('2026-09-11')).toBeNull()
  })
})
