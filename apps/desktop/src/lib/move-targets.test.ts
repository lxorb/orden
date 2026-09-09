import { describe, expect, test } from 'vitest'
import { movesInto, moveTargets, type Space } from './move-targets'
import type { Entry } from './workspace.svelte'

/** Where a row of the file list may be moved to, read as a list of paths. */

function folder(path: string, children: Entry[] = []): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  }
}

function note(path: string): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

/** A space with two folders, one of them nested, and notes in each. */
const tree = folder('/Notes', [
  folder('/Notes/Work', [folder('/Notes/Work/Deep', [note('/Notes/Work/Deep/deep.md')])]),
  folder('/Notes/Journal', [note('/Notes/Journal/monday.md')]),
  note('/Notes/loose.md'),
])

const spaces: Space[] = [
  { name: 'Notes', root: '/Notes' },
  { name: 'Uni', root: '/Uni' },
  { name: 'Archive', root: '/Archive' },
]

const where = (moving: string) =>
  moveTargets({ moving, tree, spaces, here: '/Notes' }).map((one) => one.id)

const labels = (moving: string) =>
  moveTargets({ moving, tree, spaces, here: '/Notes' }).map((one) => one.label)

describe('moving a note', () => {
  test('offers every folder of the space and every other space', () => {
    expect(where('/Notes/loose.md')).toEqual([
      '/Notes/Work',
      '/Notes/Work/Deep',
      '/Notes/Journal',
      '/Uni',
      '/Archive',
    ])
  })

  test('leaves out the folder it is already in', () => {
    expect(where('/Notes/Journal/monday.md')).not.toContain('/Notes/Journal')
    expect(where('/Notes/Journal/monday.md')).toContain('/Notes')
  })

  test('names the space for its own root, and the way in for the rest', () => {
    expect(labels('/Notes/Journal/monday.md')).toEqual([
      'Notes',
      'Work',
      'Work/Deep',
      'Uni',
      'Archive',
    ])
  })
})

describe('moving a folder', () => {
  test('cannot be put inside itself', () => {
    const offered = where('/Notes/Work')

    expect(offered).not.toContain('/Notes/Work')
    expect(offered).not.toContain('/Notes/Work/Deep')
  })

  test('nor into where it already sits, which is the space itself here', () => {
    expect(where('/Notes/Work')).toEqual(['/Notes/Journal', '/Uni', '/Archive'])
  })

  test('a nested one may come up to the space it is in', () => {
    expect(where('/Notes/Work/Deep')).toContain('/Notes')
  })
})

describe('a space of its own', () => {
  test('is offered whether or not the file list has been read', () => {
    const offered = moveTargets({
      moving: '/Notes/loose.md',
      tree: null,
      spaces,
      here: '/Notes',
    })

    expect(offered.map((one) => one.id)).toEqual(['/Uni', '/Archive'])
  })

  test('is never the one on screen, which the folders already cover', () => {
    expect(where('/Notes/loose.md').filter((one) => one === '/Notes')).toEqual([])
  })

  test('is nothing at all when there is only the one', () => {
    const offered = moveTargets({
      moving: '/Notes/loose.md',
      tree: null,
      spaces: [{ name: 'Notes', root: '/Notes' }],
      here: '/Notes',
    })

    expect(offered).toEqual([])
  })
})

/** The same rule the other way round: a drag names the folder and asks whether
 *  it takes what is coming, which is what decides whether the row lights. */
describe('whether a drop would move anything', () => {
  test('yes, into another folder of the space', () => {
    expect(movesInto(['/Notes/loose.md'], '/Notes/Work')).toBe(true)
    expect(movesInto(['/Notes/Work'], '/Notes/Journal')).toBe(true)
  })

  test('no, into the folder the row already sits in', () => {
    expect(movesInto(['/Notes/Journal/monday.md'], '/Notes/Journal')).toBe(false)
    expect(movesInto(['/Notes/loose.md'], '/Notes')).toBe(false)
  })

  test('no, for a folder onto itself or onto a folder inside it', () => {
    expect(movesInto(['/Notes/Work'], '/Notes/Work')).toBe(false)
    expect(movesInto(['/Notes/Work'], '/Notes/Work/Deep')).toBe(false)
  })

  test('yes, for a folder whose name merely starts the target’s', () => {
    expect(movesInto(['/Notes/Work'], '/Notes/Workshop')).toBe(true)
  })

  test('yes when any one of a selection would move', () => {
    const both = ['/Notes/Journal/monday.md', '/Notes/loose.md']
    expect(movesInto(both, '/Notes/Journal')).toBe(true)
    expect(movesInto([], '/Notes/Journal')).toBe(false)
  })

  test('and reads a backslash path the same way', () => {
    expect(movesInto(['C:\\Nib\\Notes\\Work'], 'C:\\Nib\\Notes\\Work\\Deep')).toBe(false)
    expect(movesInto(['C:\\Nib\\Notes\\loose.md'], 'C:\\Nib\\Notes\\Work')).toBe(true)
  })
})

describe('a path written with backslashes, as a desktop hands them over', () => {
  const windows = folder('C:\\Nib\\Notes', [
    folder('C:\\Nib\\Notes\\Work'),
    note('C:\\Nib\\Notes\\loose.md'),
  ])

  test('finds the folder it sits in all the same', () => {
    const offered = moveTargets({
      moving: 'C:\\Nib\\Notes\\Work\\one.md',
      tree: windows,
      spaces: [{ name: 'Notes', root: 'C:\\Nib\\Notes' }],
      here: 'C:\\Nib\\Notes',
    })

    expect(offered.map((one) => one.id)).toEqual(['C:\\Nib\\Notes'])
    expect(offered.map((one) => one.label)).toEqual(['Notes'])
  })

  test('and will not put a folder into itself', () => {
    const offered = moveTargets({
      moving: 'C:\\Nib\\Notes\\Work',
      tree: windows,
      spaces: [{ name: 'Notes', root: 'C:\\Nib\\Notes' }],
      here: 'C:\\Nib\\Notes',
    })

    expect(offered).toEqual([])
  })
})
