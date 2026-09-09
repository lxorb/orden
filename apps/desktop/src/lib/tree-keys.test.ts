import { describe, expect, test } from 'vitest'
import { treeStep, type TreeRow, TREE_MOVES } from './tree-keys'

/** A space with a folder open in it, as the list shows it:
 *
 *      Work/            open
 *        Notes/         shut
 *        plan.md
 *      Read me.md       */
const ROWS: TreeRow[] = [
  { path: '/s/Work', folder: true, open: true },
  { path: '/s/Work/Notes', folder: true, open: false },
  { path: '/s/Work/plan.md', folder: false, open: false },
  { path: '/s/Read me.md', folder: false, open: false },
]

describe('walking the file list', () => {
  test('goes down a row', () => {
    expect(treeStep('ArrowDown', ROWS, '/s/Work')).toEqual({ do: 'stand', path: '/s/Work/Notes' })
  })

  test('goes up a row', () => {
    expect(treeStep('ArrowUp', ROWS, '/s/Work/plan.md')).toEqual({
      do: 'stand',
      path: '/s/Work/Notes',
    })
  })

  /** The ends do not meet: falling off the bottom of a folder into the top of
   *  the space would lose the place somebody was reading down from. */
  test('stays where it is at either end', () => {
    expect(treeStep('ArrowDown', ROWS, '/s/Read me.md')).toEqual({
      do: 'stand',
      path: '/s/Read me.md',
    })
    expect(treeStep('ArrowUp', ROWS, '/s/Work')).toEqual({ do: 'stand', path: '/s/Work' })
  })

  test('starts at the top when it is standing nowhere', () => {
    expect(treeStep('ArrowDown', ROWS, null)).toEqual({ do: 'stand', path: '/s/Work' })
  })

  test('opens a shut folder', () => {
    expect(treeStep('ArrowRight', ROWS, '/s/Work/Notes')).toEqual({
      do: 'expand',
      path: '/s/Work/Notes',
    })
  })

  test('steps into a folder that is already open', () => {
    expect(treeStep('ArrowRight', ROWS, '/s/Work')).toEqual({
      do: 'stand',
      path: '/s/Work/Notes',
    })
  })

  test('closes an open folder', () => {
    expect(treeStep('ArrowLeft', ROWS, '/s/Work')).toEqual({ do: 'collapse', path: '/s/Work' })
  })

  test('steps out of a note to the folder holding it', () => {
    expect(treeStep('ArrowLeft', ROWS, '/s/Work/plan.md')).toEqual({
      do: 'stand',
      path: '/s/Work',
    })
    expect(treeStep('ArrowLeft', ROWS, '/s/Work/Notes')).toEqual({
      do: 'stand',
      path: '/s/Work',
    })
  })

  test('does nothing sideways on a row at the top of the space', () => {
    expect(treeStep('ArrowLeft', ROWS, '/s/Read me.md')).toBeNull()
    expect(treeStep('ArrowRight', ROWS, '/s/Read me.md')).toBeNull()
  })

  /** An open folder with nothing in it: the row after it is its neighbour, not
   *  its child, and stepping onto that would be stepping past the folder. */
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

  test('says nothing about a key that is not one of its own', () => {
    expect(treeStep('Enter', ROWS, '/s/Work')).toBeNull()
    expect(treeStep('F2', ROWS, '/s/Work')).toBeNull()
    expect(treeStep('a', ROWS, '/s/Work')).toBeNull()
  })

  test('says nothing about a row that is not on show', () => {
    expect(treeStep('ArrowRight', ROWS, '/s/Gone.md')).toBeNull()
    expect(treeStep('ArrowLeft', ROWS, '/s/Gone.md')).toBeNull()
  })

  test('has nowhere to go in an empty space', () => {
    expect(treeStep('ArrowDown', [], null)).toBeNull()
  })
})

describe('the keys the list walks with', () => {
  test('are four, one per direction', () => {
    expect(TREE_MOVES.map(([, key]) => key)).toEqual([
      'ArrowDown',
      'ArrowUp',
      'ArrowRight',
      'ArrowLeft',
    ])
  })

  test('are all in the file list group of the registry', async () => {
    const { BY_ID } = await import('./shortcuts/registry')

    for (const [id, key] of TREE_MOVES) {
      const entry = BY_ID.get(id)
      expect(entry, id).toBeDefined()
      expect(entry?.key, id).toBe(key)
      expect(entry?.scope, id).toBe('panel')
      // Contextual, so sharing the arrows with the editor's own motion and with
      // the plane's nudges is not reported as a clash.
      expect(entry?.contextual, id).toBe(true)
    }
  })
})
