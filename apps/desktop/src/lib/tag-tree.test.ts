import { describe, expect, test } from 'vitest'
import { liftedFrom, nodesIn, renamedTo, type TagNode, tagTree } from './tag-tree'

/** One row of what a space is tagged with, as `spaceTags` answers it: a row per
 *  level, and the notes under that level already rolled up. So a note tagged
 *  `#work/nib` is a row for `work` and a row for `work/nib`, and the tree hangs them
 *  rather than adding them up again. See link-index.svelte.ts. */
const tag = (one: string, notes = 1) => ({ tag: one, notes })

/** The tree as `path notes` lines, indented by depth, so a case says the whole
 *  shape in one string rather than in a nest of objects. */
function drawn(nodes: readonly TagNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.path} ${node.notes}`,
    ...drawn(node.children, depth + 1),
  ])
}

describe('building the tree', () => {
  test('makes a node of every segment', () => {
    // One note tagged `#work/nib/canvas`, which is one note under all three levels.
    expect(drawn(tagTree([tag('#work'), tag('#work/nib'), tag('#work/nib/canvas')]))).toEqual([
      'work 1',
      '  work/nib 1',
      '    work/nib/canvas 1',
    ])
  })

  test('to any depth', () => {
    const deep = tagTree([tag('#a/b/c/d/e/f')])
    expect(nodesIn(deep).map((node) => node.path)).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'a/b/c/d',
      'a/b/c/d/e',
      'a/b/c/d/e/f',
    ])
  })

  test('and joins the tags that share one', () => {
    // Two notes, one under `work/nib` and one under `work/lab`: two notes under
    // `work`, which is the row the counting already worked out.
    expect(drawn(tagTree([tag('#work', 2), tag('#work/nib'), tag('#work/lab')]))).toEqual([
      'work 2',
      '  work/lab 1',
      '  work/nib 1',
    ])
  })

  test('and takes the number on a row as given rather than adding the children up', () => {
    // Three notes carry `#work` and two carry `#work/nib`: five notes are under
    // `work`, and that is what the row says. Adding the child in again would say
    // seven, and counting a note twice for a level it is under is the whole of what
    // this must not do.
    expect(drawn(tagTree([tag('#work', 5), tag('#work/nib', 2)]))).toEqual([
      'work 5',
      '  work/nib 2',
    ])
  })

  test('alphabetical at every level, so it holds still as counts change', () => {
    const tree = tagTree([tag('#zebra', 9), tag('#apple'), tag('#work/z'), tag('#work/a')])
    expect(tree.map((node) => node.name)).toEqual(['apple', 'work', 'zebra'])
    expect(tree[1]?.children.map((node) => node.name)).toEqual(['a', 'z'])
  })

  test('folded, so one spelling is one node', () => {
    // The counting folds already, so this is what the tree does with two rows for
    // one path rather than something it is ever handed: one node, both notes.
    expect(drawn(tagTree([tag('#Work/Nib'), tag('#work/nib')]))).toEqual(['work 0', '  work/nib 2'])
  })

  test('and a level nothing mentioned is still a parent, with nothing of its own', () => {
    // `a` has no row here, and the branch under it must not be lost for that.
    expect(drawn(tagTree([tag('#a/b')]))).toEqual(['a 0', '  a/b 1'])
  })

  test('and a slash nobody meant makes no empty node', () => {
    expect(drawn(tagTree([tag('#work/'), tag('#a//b')]))).toEqual(['a 0', '  a/b 1', 'work 1'])
  })

  test('and nothing at all out of nothing', () => {
    expect(tagTree([])).toEqual([])
  })
})

describe('a node being renamed', () => {
  test('keeps its parent', () => {
    expect(renamedTo('work/nib', 'core')).toBe('work/core')
    expect(renamedTo('work', 'jobs')).toBe('jobs')
  })

  test('folded, since the tree is', () => {
    expect(renamedTo('work/nib', 'Core')).toBe('work/core')
  })

  test('and a name with slashes moves it', () => {
    expect(renamedTo('work/nib', 'core/nib')).toBe('work/core/nib')
  })

  test('but never inside itself, which would never stop', () => {
    expect(renamedTo('work', 'work/nib')).toBeNull()
    expect(renamedTo('work/nib', 'nib')).toBeNull()
  })

  test('and an empty name is not a rename', () => {
    expect(renamedTo('work/nib', '  ')).toBeNull()
    expect(renamedTo('work/nib', '///')).toBeNull()
  })
})

describe('a node being lifted', () => {
  test('leaves its parent behind', () => {
    expect(liftedFrom('work/nib/canvas')).toBe('work/nib')
    expect(liftedFrom('work/nib')).toBe('work')
  })

  test('and a node at the top has nowhere to go', () => {
    expect(liftedFrom('work')).toBeNull()
  })
})
