import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Where a base's automations and a repeating template put a note.
 *
 *  Both are told the folder by words anybody who can write the space can write: a
 *  base's `move` effect, and the template's `folder:` property. Joined to the root as
 *  written, `../Private` moved a note into another space, or made the day's note
 *  there over whatever was there. */

const { written, template, moved, plan } = vi.hoisted(() => ({
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
  planned: () => ({
    writes: [],
    moves: [{ row: { space: 'Shared', path: 'Inbox/a.md' }, folder: plan.folder }],
    notices: [],
  }),
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

const { heard, readHeld, repeatTemplates } = await import('./running')

beforeEach(() => {
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
