import { describe, expect, test } from 'vitest'
import { treeStep, type TreeRow, TREE_MOVES } from './tree-keys'
import { BY_ID } from '../../shortcuts/src/registry'

const ROWS: TreeRow[] = [
  { path: '/s/Work', folder: true, open: true },
  { path: '/s/Work/Notes', folder: true, open: false },
  { path: '/s/Work/plan.md', folder: false, open: false },
  { path: '/s/Read me.md', folder: false, open: false },
]

describe('walking the file list', () => {
  const stand = (path: string) => ({ do: 'stand', path })
  test.each([
    ['goes down a row', 'ArrowDown', '/s/Work', stand('/s/Work/Notes')],
    ['goes up a row', 'ArrowUp', '/s/Work/plan.md', stand('/s/Work/Notes')],
    ['stays at the bottom', 'ArrowDown', '/s/Read me.md', stand('/s/Read me.md')],
    ['stays at the top', 'ArrowUp', '/s/Work', stand('/s/Work')],
    ['starts at the top when it is standing nowhere', 'ArrowDown', null, stand('/s/Work')],
    ['opens a shut folder', 'ArrowRight', '/s/Work/Notes', { do: 'expand', path: '/s/Work/Notes' }],
    ['steps into a folder that is already open', 'ArrowRight', '/s/Work', stand('/s/Work/Notes')],
    ['closes an open folder', 'ArrowLeft', '/s/Work', { do: 'collapse', path: '/s/Work' }],
    ['steps out of a note to its folder', 'ArrowLeft', '/s/Work/plan.md', stand('/s/Work')],
    ['steps out of a folder to its folder', 'ArrowLeft', '/s/Work/Notes', stand('/s/Work')],
    ['does nothing left at the top of the space', 'ArrowLeft', '/s/Read me.md', null],
    ['does nothing right at the top of the space', 'ArrowRight', '/s/Read me.md', null],
    ['ignores Enter', 'Enter', '/s/Work', null],
    ['ignores F2', 'F2', '/s/Work', null],
    ['ignores a letter', 'a', '/s/Work', null],
    ['ignores right on a row not on show', 'ArrowRight', '/s/Gone.md', null],
    ['ignores left on a row not on show', 'ArrowLeft', '/s/Gone.md', null],
  ] as const)('%s', (_name, key, at, step) => {
    expect(treeStep(key, ROWS, at)).toEqual(step)
  })

  test('has nowhere to step into an open folder that is empty', () => {
    const rows: TreeRow[] = [
      { path: '/s/Empty', folder: true, open: true },
      { path: '/s/next.md', folder: false, open: false },
    ]
    expect(treeStep('ArrowRight', rows, '/s/Empty')).toBeNull()
  })

  test('walks a list written with backslashes too', () => {
    const rows: TreeRow[] = [
      { path: 'C:\\s\\Work', folder: true, open: true },
      { path: 'C:\\s\\Work\\plan.md', folder: false, open: false },
    ]
    expect(treeStep('ArrowLeft', rows, 'C:\\s\\Work\\plan.md')).toEqual({
      do: 'stand',
      path: 'C:\\s\\Work',
    })
  })

  test('has nowhere to go in an empty space', () => {
    expect(treeStep('ArrowDown', [], null)).toBeNull()
  })
})

describe('the keys the list walks with', () => {
  test('are four, one per direction', () => {
    expect(TREE_MOVES.map(([, key]) => key)).toEqual(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'])
  })

  test('are all in the file list group of the registry', () => {
    for (const [id, key] of TREE_MOVES) {
      const entry = BY_ID.get(id)
      expect(entry, id).toBeDefined()
      expect(entry?.key, id).toBe(key)
      expect(entry?.scope, id).toBe('panel')
      expect(entry?.contextual, id).toBe(true)
    }
  })
})
