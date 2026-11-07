import { describe, expect, test } from 'vitest'
import { copiesInto, movesInto, moveTargets, type Space } from './move-targets'
import type { Entry } from './workspace.svelte'

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

const tree = folder('/Notes', [
  folder('/Notes/Work', [folder('/Notes/Work/Deep', [note('/Notes/Work/Deep/deep.md')])]),
  folder('/Notes/Journal', [note('/Notes/Journal/monday.md')]),
  note('/Notes/loose.md'),
])

const spaces: Space[] = [
  { id: 'n', name: 'Notes', root: '/Notes' },
  { id: 'u', name: 'Uni', root: '/Uni' },
  { id: 'a', name: 'Archive', root: '/Archive' },
]

const where = (moving: string) =>
  moveTargets({ moving, tree, spaces, here: '/Notes' }).map((one) => one.id)

const labels = (moving: string) =>
  moveTargets({ moving, tree, spaces, here: '/Notes' }).map((one) => one.label)

describe('moving a note', () => {
  test('offers every row of the space, and every other space', () => {
    expect(where('/Notes/loose.md')).toEqual([
      '/Notes/Work',
      '/Notes/Work/Deep',
      '/Notes/Work/Deep/deep',
      '/Notes/Journal',
      '/Notes/Journal/monday',
      '/Uni',
      '/Archive',
    ])
  })

  test('leaves out the folder it is already in', () => {
    expect(where('/Notes/Journal/monday.md')).not.toContain('/Notes/Journal')
    expect(where('/Notes/Journal/monday.md')).toContain('/Notes')
  })

  test('and itself, which is the folder it would itself become', () => {
    expect(where('/Notes/Journal/monday.md')).not.toContain('/Notes/Journal/monday')
    expect(where('/Notes/Journal/monday.md')).toContain('/Notes/loose')
  })

  test('names the space for its own root, and the way in for the rest', () => {
    expect(labels('/Notes/Journal/monday.md')).toEqual([
      'Notes',
      'Work',
      'Work/Deep',
      'Work/Deep/deep',
      'loose',
      'Uni',
      'Archive',
    ])
  })

  test('and every place in the space is a note, while a space is a space', () => {
    const marks = moveTargets({ moving: '/Notes/loose.md', tree, spaces, here: '/Notes' }).map(
      (one) => `${one.label}: ${one.space ? 'space' : one.mark}`,
    )

    expect(marks).toEqual([
      'Work: note',
      'Work/Deep: note',
      'Work/Deep/deep: note',
      'Journal: note',
      'Journal/monday: note',
      'Uni: space',
      'Archive: space',
    ])
  })

  test('and a space says which space it is', () => {
    const offered = moveTargets({
      moving: '/Notes/Journal/monday.md',
      tree,
      spaces,
      here: '/Notes',
    })

    expect(offered[0]).toEqual({ id: '/Notes', label: 'Notes', space: { id: 'n', name: 'Notes' } })
    expect(offered.at(-1)).toEqual({
      id: '/Archive',
      label: 'Archive',
      space: { id: 'a', name: 'Archive' },
    })
  })
})

describe('moving a folder', () => {
  test('cannot be put inside itself', () => {
    const offered = where('/Notes/Work')

    expect(offered).not.toContain('/Notes/Work')
    expect(offered).not.toContain('/Notes/Work/Deep')
  })

  test('nor under a note it holds', () => {
    expect(where('/Notes/Work')).not.toContain('/Notes/Work/Deep/deep')
  })

  test('nor into where it already sits, which is the space itself here', () => {
    expect(where('/Notes/Work')).toEqual([
      '/Notes/Journal',
      '/Notes/Journal/monday',
      '/Notes/loose',
      '/Uni',
      '/Archive',
    ])
  })

  test('a nested one may come up to the space it is in', () => {
    expect(where('/Notes/Work/Deep')).toContain('/Notes')
  })
})

describe('a note that is already nested', () => {
  const nested = folder('/Notes', [
    folder('/Notes/A', [note('/Notes/A/A.md'), note('/Notes/A/B.md')]),
    note('/Notes/loose.md'),
  ])

  const offered = moveTargets({
    moving: '/Notes/loose.md',
    tree: nested,
    spaces: [{ id: 'n', name: 'Notes', root: '/Notes' }],
    here: '/Notes',
  })

  test('is one place, wearing the note mark, with what it holds under it', () => {
    expect(offered).toEqual([
      { id: '/Notes/A', label: 'A', mark: 'note' },
      { id: '/Notes/A/B', label: 'A/B', mark: 'note' },
    ])
  })

  test('and its own note is not a second place, since there is no A/A/', () => {
    expect(offered.map((one) => one.id)).not.toContain('/Notes/A/A')
  })
})

describe('a folder with the note beside it rather than inside', () => {
  const beside = folder('/Notes', [
    folder('/Notes/A', [note('/Notes/A/x.md')]),
    note('/Notes/A.md'),
    note('/Notes/loose.md'),
  ])

  const where2 = (moving: string) =>
    moveTargets({
      moving,
      tree: beside,
      spaces: [{ id: 'n', name: 'Notes', root: '/Notes' }],
      here: '/Notes',
    }).map((one) => one.id)

  test('is offered once and not twice', () => {
    expect(where2('/Notes/loose.md')).toEqual(['/Notes/A', '/Notes/A/x'])
  })

  test('and the note beside it may still be moved into it', () => {
    expect(where2('/Notes/A.md')).toContain('/Notes/A')
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
      spaces: [{ id: 'n', name: 'Notes', root: '/Notes' }],
      here: '/Notes',
    })

    expect(offered).toEqual([])
  })
})

describe('nothing moving, which is where a new file could go', () => {
  const every = () => moveTargets({ moving: null, tree, spaces, here: '/Notes' }).map((o) => o.id)

  test('offers every place there is', () => {
    expect(every().length).toBeGreaterThan(where('/Notes/loose.md').length)
    expect(every()[0]).toBe('/Notes')
    expect(every()).toContain('/Notes/loose')
  })

  test('and the other spaces with them', () => {
    expect(every()).toContain('/Uni')
    expect(every()).toContain('/Archive')
  })
})

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
    expect(movesInto(['C:\\Orden\\Notes\\Work'], 'C:\\Orden\\Notes\\Work\\Deep')).toBe(false)
    expect(movesInto(['C:\\Orden\\Notes\\loose.md'], 'C:\\Orden\\Notes\\Work')).toBe(true)
  })
})

describe('a path written with backslashes, as a desktop hands them over', () => {
  const windows = folder('C:\\Orden\\Notes', [
    folder('C:\\Orden\\Notes\\Work'),
    note('C:\\Orden\\Notes\\loose.md'),
  ])

  test('finds the folder it sits in all the same', () => {
    const offered = moveTargets({
      moving: 'C:\\Orden\\Notes\\Work\\one.md',
      tree: windows,
      spaces: [{ id: 'n', name: 'Notes', root: 'C:\\Orden\\Notes' }],
      here: 'C:\\Orden\\Notes',
    })

    expect(offered.map((one) => one.id)).toEqual(['C:\\Orden\\Notes', 'C:\\Orden\\Notes\\loose'])
    expect(offered.map((one) => one.label)).toEqual(['Notes', 'loose'])
  })

  test('and will not put a folder into itself', () => {
    const offered = moveTargets({
      moving: 'C:\\Orden\\Notes\\Work',
      tree: windows,
      spaces: [{ id: 'n', name: 'Notes', root: 'C:\\Orden\\Notes' }],
      here: 'C:\\Orden\\Notes',
    })

    expect(offered).toEqual([{ id: 'C:\\Orden\\Notes\\loose', label: 'loose', mark: 'note' }])
  })
})

describe('copying a row', () => {
  test('may land beside itself, but never inside itself', () => {
    expect(copiesInto(['/s/a.md'], '/s')).toBe(true)
    expect(copiesInto(['/s/Work'], '/s/Work')).toBe(false)
    expect(copiesInto(['/s/Work'], '/s/Work/deep')).toBe(false)
    expect(copiesInto(['/s/Work'], '/s/Workshop')).toBe(true)
  })
})
