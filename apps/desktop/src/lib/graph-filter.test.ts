import { describe, expect, test } from 'vitest'
import type { GraphNode } from './graph'
import { graphFilter } from './graph-filter'
import { parseQuery } from './search/query'

/** One node of a picture, as much of it as a filter reads. */
const node = (id: string, tags: string[] = []): GraphNode => ({
  id,
  name: (id.split('/').pop() ?? id).replace(/\.md$/, ''),
  path: id,
  degree: 0,
  tags,
})

const PLAN = node('work/Plan.md', ['work/nib', 'later'])
const DIARY = node('Diary.md', ['diary'])
const SHOPPING = node('house/Shopping list.md')

const kept = (source: string, nodes: GraphNode[] = [PLAN, DIARY, SHOPPING]) =>
  nodes.filter(graphFilter(parseQuery(source))).map((one) => one.name)

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
    expect(kept('tag:work/nib')).toEqual(['Plan'])
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

/** What the picture cannot hear, it does not answer with an empty picture: a
 *  filter that emptied the view over an operator it cannot read would look like
 *  the truth about the space. */
describe('an operator the picture cannot answer', () => {
  test('front matter narrows nothing', () => {
    expect(kept('[status:done]')).toEqual(['Plan', 'Diary', 'Shopping list'])
  })

  test('but the words a nearness group holds still narrow', () => {
    expect(kept('line:(plan work)')).toEqual(['Plan'])
    expect(kept('line:(plan diary)')).toEqual([])
  })
})
