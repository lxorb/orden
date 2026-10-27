import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Where a base's automations and a repeating template put a note.
 *
 *  Both are told the folder by words anybody who can write the space can write: a
 *  base's `move` effect, and the template's `folder:` property. Joined to the root as
 *  written, `../Private` moved a note into another space, or made the day's note
 *  there over whatever was there. */

const { written, template, moved, plan, before } = vi.hoisted(() => ({
  before: [] as unknown[][],
  written: new Map<string, string>(),
  template: { folder: '' },
  moved: [] as string[],
  plan: { folder: '' },
}))

vi.mock('@nib/bases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nib/bases')>()),
  repeatDue: () => ({ day: '2026-10-24', missed: [] }),
  // Every base is one worth running.
  readBase: () => ({ nib: { id: 'tasks' } }),
  readAutomations: () => [],
}))
vi.mock('./automate', () => ({
  planned: (_bases: unknown, removed: unknown[]) => {
    before.push(removed)
    return {
      writes: [],
      moves: [{ row: { space: 'Shared', path: 'Inbox/a.md' }, folder: plan.folder }],
      notices: [],
    }
  },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'shared', name: 'Shared', root: '/s/Shared' }],
    move: async (from: string, to: string) => void moved.push(`${from} -> ${to}`),
    activeSpace: { id: 'shared', name: 'Shared', root: '/s/Shared' },
    documentAt: () => null,
    freeName: (_dir: string, wanted: string) => wanted,
    freeNameOnDisk: (_dir: string, wanted: string) => Promise.resolve(wanted),
    fileCame: async () => undefined,
    noteText: async () => '---\nrepeat: daily\n---\n',
    loadTree: async () => undefined,
  },
}))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    ready: true,
    of: () => [
      {
        kind: 'note',
        path: 'Templates/Daily.md',
        file: { basename: 'Daily' },
        note: { repeat: 'daily', folder: template.folder },
      },
    ],
  },
}))
vi.mock('./templates', () => ({
  templatesFolder: async () => 'Templates',
  templateWords: async () => '# Daily\n',
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async () => undefined,
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: async (path: string, content: string) => void written.set(path, content),
}))
vi.mock('../reminders/platform', () => ({ show: () => undefined }))
// Every space here may be written in; one that may not is read-only.test.ts's.
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))

const { heard, heardChange, readHeld, repeatTemplates } = await import('./running')
const { moving } = await import('./moving')

beforeEach(() => {
  before.length = 0
  written.clear()
  moved.length = 0
})

describe("a base's automation that moves a note", () => {
  /** A change to the note heard, and the moment it is left to settle waited out. */
  async function changed() {
    await readHeld('/s/Shared/Tasks.base')
    heard('Shared', 'Inbox/a.md', [])
    await new Promise((done) => setTimeout(done, 150))
  }

  test('moves it into the folder the base names', async () => {
    plan.folder = 'Done'
    await changed()

    expect(moved).toEqual(['/s/Shared/Inbox/a.md -> /s/Shared/Done'])
  })

  test('moves nothing where that folder climbs out of the space', async () => {
    plan.folder = '../Private'
    await changed()

    expect(moved).toEqual([])
  })
})

describe("a repeating template's note", () => {
  test('is made in the folder the template names', async () => {
    template.folder = 'Journal'
    await repeatTemplates()

    expect(written.has('/s/Shared/Journal/Daily 2026-10-24.md')).toBe(true)
  })

  test('is not made where that folder climbs out of the space', async () => {
    template.folder = '../Private'
    await repeatTemplates()

    expect([...written.keys()].filter((path) => !path.includes('/Templates/'))).toEqual([])
  })
})

describe('a note renamed or moved', () => {
  const was = { kind: 'note', space: 'Shared', path: 'Inbox/old.md', note: { status: 'Doing' } }
  const now = { ...was, path: 'Inbox/a.md' }
  const settle = () => new Promise((done) => setTimeout(done, 150))
  const change = { root: '/s/Shared', space: 'Shared', path: 'Inbox/a.md' }
  const from = { space: 'Shared', path: 'Inbox/old.md', rows: [was] as never }

  test('is looked at with the rows it had where it was, not as a note just made', async () => {
    plan.folder = '../Private'
    await readHeld('/s/Shared/Tasks.base')
    heardChange({
      root: '/s/Shared',
      space: 'Shared',
      path: 'Inbox/a.md',
      removed: [],
      added: [now] as never,
      from: { space: 'Shared', path: 'Inbox/old.md', rows: [was] as never },
    })
    await settle()

    expect(before).toEqual([[was]])
  })

  test('written where it goes before the move is told, is still a move (B498)', async () => {
    plan.folder = '../Private'
    await readHeld('/s/Shared/Tasks.base')
    // The link rewrite's save at the new path, then the move with the rows it had.
    heardChange({ ...change, removed: [], added: [now] as never })
    heardChange({ ...change, removed: [now] as never, added: [now] as never, from })
    await settle()

    expect(before).toEqual([[was]])
  })

  test('an edit at the old path still waiting is what it was before', async () => {
    plan.folder = '../Private'
    await readHeld('/s/Shared/Tasks.base')
    const edited = { ...was, note: { status: 'Done' } }
    heardChange({
      ...change,
      path: 'Inbox/old.md',
      removed: [was] as never,
      added: [edited] as never,
    })
    heardChange({
      ...change,
      removed: [],
      added: [now] as never,
      from: { ...from, rows: [edited] as never },
    })
    await settle()

    expect(before).toEqual([[was]])
  })

  test('however long the rewrite takes before the move is told, the move is not an add', async () => {
    plan.folder = '../Private'
    await readHeld('/s/Shared/Tasks.base')
    await moving('/s/Shared/Inbox/a.md', async () => {
      heardChange({ ...change, removed: [], added: [now] as never })
      await settle()
      expect(before).toEqual([])
      heardChange({ ...change, removed: [now] as never, added: [now] as never, from })
    })
    await settle()

    expect(before).toEqual([[was]])
  })

  test('a save at a path a move never reached is looked at once the move is over', async () => {
    plan.folder = '../Private'
    await readHeld('/s/Shared/Tasks.base')
    await moving('/s/Shared/Inbox/a.md', async () => {
      heardChange({ ...change, removed: [], added: [now] as never })
      await settle()
    }).catch(() => undefined)
    await settle()

    expect(before).toEqual([[]])
  })
})
