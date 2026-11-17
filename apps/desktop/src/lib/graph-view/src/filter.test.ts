import { describe, expect, test } from 'vitest'
import type { GraphNode } from '../../graph/src/api'
import { graphFilter } from './filter'
import { parseQuery } from '@orden/scan/search/query'

const node = (id: string, tags: string[] = []): GraphNode => ({
  id,
  name: (id.split('/').pop() ?? id).replace(/\.md$/, ''),
  path: id,
  degree: 0,
  tags,
})

const PLAN = node('work/Plan.md', ['work/orden', 'later'])
const DIARY = node('Diary.md', ['diary'])
const SHOPPING = node('house/Shopping list.md')

const kept = (source: string, nodes: GraphNode[] = [PLAN, DIARY, SHOPPING]) =>
  nodes.filter(graphFilter(parseQuery(source)) ?? (() => true)).map((one) => one.name)

describe('a query over the picture of a space', () => {
  test('an empty field keeps everything', () => {
    expect(kept('')).toEqual(['Plan', 'Diary', 'Shopping list'])
  })

  test('a bare word asks the name and the path', () => {
    expect(kept('plan')).toEqual(['Plan'])
    expect(kept('house')).toEqual(['Shopping list'])
  })

  test('and folds case, the way the search does', () => {
    expect(kept('PLAN')).toEqual(['Plan'])
    expect(kept('case: PLAN')).toEqual([])
  })

  test('two words are both of them', () => {
    expect(kept('shopping list')).toEqual(['Shopping list'])
    expect(kept('shopping plan')).toEqual([])
  })

  test('a quoted phrase is the phrase', () => {
    expect(kept('"shopping list"')).toEqual(['Shopping list'])
    expect(kept('"list shopping"')).toEqual([])
  })

  test('path: asks where the note lives, file: what it is called', () => {
    expect(kept('path:work')).toEqual(['Plan'])
    expect(kept('file:work')).toEqual([])
  })

  test('tag: asks the tags, and reads their slashes as a path', () => {
    expect(kept('tag:work')).toEqual(['Plan'])
    expect(kept('tag:work/orden')).toEqual(['Plan'])
    expect(kept('tag:wor')).toEqual([])
    expect(kept('tag:diary')).toEqual(['Diary'])
  })

  test('a minus takes notes out', () => {
    expect(kept('-tag:diary')).toEqual(['Plan', 'Shopping list'])
  })

  test('OR widens', () => {
    expect(kept('plan OR diary')).toEqual(['Plan', 'Diary'])
  })

  test('brackets group', () => {
    expect(kept('(plan OR diary) -tag:later')).toEqual(['Diary'])
  })

  test('a regular expression asks the name', () => {
    expect(kept('/^Di/')).toEqual(['Diary'])
    expect(kept('/^di/')).toEqual([])
    expect(kept('/^di/i')).toEqual(['Diary'])
  })

  test('and one that does not compile keeps everything, being half typed', () => {
    expect(kept('/(/')).toEqual(['Plan', 'Diary', 'Shopping list'])
  })
})

describe('an operator the picture cannot answer', () => {
  test('front matter narrows nothing', () => {
    expect(kept('[status:done]')).toEqual(['Plan', 'Diary', 'Shopping list'])
  })

  test('but the words a nearness group holds still narrow', () => {
    expect(kept('line:(plan work)')).toEqual(['Plan'])
    expect(kept('line:(plan diary)')).toEqual([])
  })

  test('nor does it when taken out, or half typed after a minus', () => {
    expect(kept('-[status:done]')).toEqual(['Plan', 'Diary', 'Shopping list'])
    expect(kept('-task:')).toEqual(['Plan', 'Diary', 'Shopping list'])
    expect(kept('-/(/')).toEqual(['Plan', 'Diary', 'Shopping list'])
    expect(kept('-[status:done] -tag:diary')).toEqual(['Plan', 'Shopping list'])
    expect(kept('[status:done] OR diary')).toEqual(['Plan', 'Diary', 'Shopping list'])
  })

  test('says nothing at all, so a colour group of it colours no note', () => {
    expect(graphFilter(parseQuery('[status:done]'))).toBeNull()
    expect(graphFilter(parseQuery('-task:'))).toBeNull()
    expect(graphFilter(parseQuery('[status:done] tag:diary'))).not.toBeNull()
  })

  test('and a task narrows nothing, terms and all', () => {
    expect(kept('task-todo:plan')).toEqual(['Plan', 'Diary', 'Shopping list'])
    expect(kept('task:')).toEqual(['Plan', 'Diary', 'Shopping list'])
    expect(kept('task:(plan later) tag:later')).toEqual(['Plan'])
  })
})

describe('a pattern over the names that backtracks without end', () => {
  test('is left aside like a pattern that is not one, at once', () => {
    const long = node(`${'a'.repeat(27)}!.md`)
    const started = Date.now()
    expect(kept('/(a+)+b/', [long, DIARY])).toEqual([long.name, 'Diary'])
    expect(Date.now() - started).toBeLessThan(1500)
  })
})
