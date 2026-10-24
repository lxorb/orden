import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readBase } from '@nib/bases'
import { freePath } from '@nib/markdown/paths'

/** Where a base's plus puts the note it makes: the folder its filter points at,
 *  inside the base's own space and nowhere else.
 *
 *  The folder is words somebody wrote in a base file, which in a shared space is
 *  anybody the space is shared with. Joined to the root as written, `..` climbed
 *  out of the space, and a `.` step made the name look free while the disk wrote
 *  over the note it named. */

const { written, taken, on, held } = vi.hoisted(() => ({
  written: new Map<string, string>(),
  taken: new Set<string>(),
  /** The space on screen. */
  on: { root: '/s/Shared' },
  /** Every space's notes, as the rows store holds them, by space name. */
  held: new Map<string, string[]>(),
}))

vi.mock('../workspace.svelte', async () => {
  const { pathKey } = await import('../space-paths')
  const shared = { id: 'shared', name: 'Shared', root: '/s/Shared' }
  const mine = { id: 'mine', name: 'Mine', root: '/s/Private' }
  const files: Record<string, string> = {
    '/s/Private/Journal.md': 'my private diary\n',
    '/s/Shared/Templates/Journal.md': 'the shared journal\n',
  }
  return {
    workspace: {
      spaces: [shared, mine],
      get activeSpace() {
        return on.root === mine.root ? mine : shared
      },
      // The listing on screen, which is the space on screen's alone.
      get notes() {
        const space = on.root === mine.root ? mine : shared
        return (held.get(space.name) ?? []).map((relative) => ({
          path: `${space.root}/${relative}`,
          name: relative.split('/').pop() ?? relative,
        }))
      },
      noteText: async (path: string) => files[path] ?? null,
      // The store's numbering over what it knows; see `freeName` in workspace.svelte.ts.
      freeName: (dir: string, wanted: string) => {
        const keys = new Set([...taken].map((one) => pathKey(one, dir)))
        return freePath(wanted, (candidate) => keys.has(pathKey(`${dir}/${candidate}`, dir)))
      },
      // The same numbering here, where nothing is on a disk the store has not listed.
      freeNameOnDisk: (dir: string, wanted: string) => {
        const keys = new Set([...taken].map((one) => pathKey(one, dir)))
        return Promise.resolve(
          freePath(wanted, (candidate) => keys.has(pathKey(`${dir}/${candidate}`, dir))),
        )
      },
      loadTree: async () => undefined,
      fileCame: async () => undefined,
      open: async () => undefined,
      fileOps: { follow: () => undefined },
    },
  }
})
vi.mock('../workspace/write-file', () => ({
  writeFile: async (path: string, content: string) => void written.set(path, content),
}))

vi.mock('../surfaces.svelte', () => ({ showQuickAdd: () => undefined }))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    ready: true,
    of: (space: string) =>
      (held.get(space) ?? []).map((path) => ({
        kind: 'note',
        space,
        path,
        file: { basename: (path.split('/').pop() ?? path).replace(/\.md$/i, '') },
        note: {},
      })),
  },
}))
vi.mock('./act', () => ({ addTask: async () => null }))

const { addNote } = await import('./add')

const inFolder = (folder: string) =>
  readBase(
    `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: table\n    name: T\n`,
  )

beforeEach(() => {
  on.root = '/s/Shared'
  held.clear()
  written.clear()
  taken.clear()
})

describe('a note added to a base whose filter names a folder', () => {
  test('lands in that folder', async () => {
    const path = await addNote(inFolder('Projects'), 0, '/s/Shared/Tasks.base', undefined, {
      open: false,
    })

    expect(path).toBe('/s/Shared/Projects/Untitled.md')
  })

  test("lands in the base's own space, which is not always the one on screen", async () => {
    const path = await addNote(inFolder('Projects'), 0, '/s/Private/Tasks.base', undefined, {
      open: false,
    })

    expect(path).toBe('/s/Private/Projects/Untitled.md')
  })

  test('is not made where the folder climbs out of the space', async () => {
    const path = await addNote(inFolder('../Private'), 0, '/s/Shared/Tasks.base', undefined, {
      open: false,
    })

    expect(path).toBeNull()
    expect([...written.keys()]).toEqual([])
  })

  test('steps past a note there however the folder is spelled', async () => {
    taken.add('/s/Shared/Projects/Untitled.md')

    const path = await addNote(inFolder('./Projects'), 0, '/s/Shared/Tasks.base', undefined, {
      open: false,
    })

    expect(path).toBe('/s/Shared/Projects/Untitled 2.md')
  })
})

describe('a note added to a base with a template, from a tab of another space', () => {
  const journal = () =>
    readBase(
      `filters:\n  and:\n    - file.inFolder("Inbox")\nnib:\n  template: "[[Journal]]"\nviews:\n  - type: table\n    name: T\n`,
    )

  beforeEach(() => {
    // The reader's own space is on screen; the shared board is a tab kept from before.
    on.root = '/s/Private'
    held.set('Mine', ['Journal.md'])
  })

  test('never takes the template from the space on screen', async () => {
    const path = await addNote(journal(), 0, '/s/Shared/Board.base', undefined, { open: false })

    expect(path).toBe('/s/Shared/Inbox/Untitled.md')
    expect(written.get('/s/Shared/Inbox/Untitled.md') ?? '').not.toContain('my private diary')
  })

  test("takes it from the base's own space", async () => {
    held.set('Shared', ['Templates/Journal.md'])

    const path = await addNote(journal(), 0, '/s/Shared/Board.base', undefined, { open: false })

    expect(written.get(path ?? '')).toContain('the shared journal')
  })
})
