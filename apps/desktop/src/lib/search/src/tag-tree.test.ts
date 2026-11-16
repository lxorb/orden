import { describe, expect, test } from 'vitest'
import { liftedFrom, nodesIn, renamedTo, type TagNode, tagTree } from './tag-tree'

const tag = (one: string, notes = 1) => ({ tag: one, notes })

function drawn(nodes: readonly TagNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.path} ${node.notes}`,
    ...drawn(node.children, depth + 1),
  ])
}

describe('building the tree', () => {
  test('makes a node of every segment', () => {
    expect(drawn(tagTree([tag('#work'), tag('#work/orden'), tag('#work/orden/canvas')]))).toEqual([
      'work 1',
      '  work/orden 1',
      '    work/orden/canvas 1',
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
    expect(drawn(tagTree([tag('#work', 2), tag('#work/orden'), tag('#work/lab')]))).toEqual([
      'work 2',
      '  work/lab 1',
      '  work/orden 1',
    ])
  })

  test('and takes the number on a row as given rather than adding the children up', () => {
    expect(drawn(tagTree([tag('#work', 5), tag('#work/orden', 2)]))).toEqual([
      'work 5',
      '  work/orden 2',
    ])
  })

  test('alphabetical at every level, so it holds still as counts change', () => {
    const tree = tagTree([tag('#zebra', 9), tag('#apple'), tag('#work/z'), tag('#work/a')])
    expect(tree.map((node) => node.name)).toEqual(['apple', 'work', 'zebra'])
    expect(tree[1]?.children.map((node) => node.name)).toEqual(['a', 'z'])
  })

  test('folded, so one spelling is one node', () => {
    expect(drawn(tagTree([tag('#Work/Orden'), tag('#work/orden')]))).toEqual([
      'work 0',
      '  work/orden 2',
    ])
  })

  test('and a level nothing mentioned is still a parent, with nothing of its own', () => {
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
    expect(renamedTo('work/orden', 'core')).toBe('work/core')
    expect(renamedTo('work', 'jobs')).toBe('jobs')
  })

  test('folded, since the tree is', () => {
    expect(renamedTo('work/orden', 'Core')).toBe('work/core')
  })

  test('and a name with slashes moves it', () => {
    expect(renamedTo('work/orden', 'core/orden')).toBe('work/core/orden')
  })

  test('but never inside itself, which would never stop', () => {
    expect(renamedTo('work', 'work/orden')).toBeNull()
    expect(renamedTo('work/orden', 'orden')).toBeNull()
  })

  test('and an empty name is not a rename', () => {
    expect(renamedTo('work/orden', '  ')).toBeNull()
    expect(renamedTo('work/orden', '///')).toBeNull()
  })
})

describe('a node being lifted', () => {
  test('leaves its parent behind', () => {
    expect(liftedFrom('work/orden/canvas')).toBe('work/orden')
    expect(liftedFrom('work/orden')).toBe('work')
  })

  test('and a node at the top has nowhere to go', () => {
    expect(liftedFrom('work')).toBeNull()
  })
})
