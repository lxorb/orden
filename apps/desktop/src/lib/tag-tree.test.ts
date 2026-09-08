import { describe, expect, test } from 'vitest'
import { liftedFrom, nodesIn, renamedTo, type TagNode, tagTree } from './tag-tree'

/** A tag and how often the space uses it, as `space_tags` answers. */
const tag = (one: string, count = 1) => ({ tag: one, count })

/** The tree as `path count` lines, indented by depth, so a case says the whole
 *  shape in one string rather than in a nest of objects. */
function drawn(nodes: readonly TagNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.path} ${node.own}/${node.total}`,
    ...drawn(node.children, depth + 1),
  ])
}

describe('building the tree', () => {
  test('makes a node of every segment', () => {
    expect(drawn(tagTree([tag('#work/nib/canvas')]))).toEqual([
      'work 0/1',
      '  work/nib 0/1',
      '    work/nib/canvas 1/1',
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
    expect(drawn(tagTree([tag('#work/nib'), tag('#work/lab')]))).toEqual([
      'work 0/2',
      '  work/lab 1/1',
      '  work/nib 1/1',
    ])
  })

  test('with a parent that is a tag of its own counted in both', () => {
    expect(drawn(tagTree([tag('#work', 3), tag('#work/nib', 2)]))).toEqual([
      'work 3/5',
      '  work/nib 2/2',
    ])
  })

  test('alphabetical at every level, so it holds still as counts change', () => {
    const tree = tagTree([tag('#zebra', 9), tag('#apple'), tag('#work/z'), tag('#work/a')])
    expect(tree.map((node) => node.name)).toEqual(['apple', 'work', 'zebra'])
    expect(tree[1]?.children.map((node) => node.name)).toEqual(['a', 'z'])
  })

  test('folded, so one spelling is one node', () => {
    expect(drawn(tagTree([tag('#Work/Nib'), tag('#work/nib')]))).toEqual([
      'work 0/2',
      '  work/nib 2/2',
    ])
  })

  test('and a slash nobody meant makes no empty node', () => {
    expect(drawn(tagTree([tag('#work/'), tag('#a//b')]))).toEqual([
      'a 0/1',
      '  a/b 1/1',
      'work 1/1',
    ])
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
