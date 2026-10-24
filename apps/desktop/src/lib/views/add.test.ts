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

const { written, taken } = vi.hoisted(() => ({
  written: new Map<string, string>(),
  taken: new Set<string>(),
}))

vi.mock('../workspace.svelte', async () => {
  const { pathKey } = await import('../space-paths')
  const shared = { id: 'shared', name: 'Shared', root: '/s/Shared' }
  return {
    workspace: {
      spaces: [shared, { id: 'mine', name: 'Mine', root: '/s/Private' }],
      activeSpace: shared,
      // The store's numbering over what it knows; see `freeName` in workspace.svelte.ts.
      freeName: (dir: string, wanted: string) => {
        const keys = new Set([...taken].map((one) => pathKey(one, dir)))
        return freePath(wanted, (candidate) => keys.has(pathKey(`${dir}/${candidate}`, dir)))
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
vi.mock('../rows/rows.svelte', () => ({ rows: {} }))
vi.mock('./act', () => ({ addTask: async () => null }))

const { addNote } = await import('./add')

const inFolder = (folder: string) =>
  readBase(
    `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: table\n    name: T\n`,
  )

beforeEach(() => {
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
