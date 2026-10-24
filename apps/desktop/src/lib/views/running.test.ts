import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The notes a repeating template makes, and where it makes them.
 *
 *  The template says where in its `folder:` property, words anybody who can write
 *  the space can write. Joined to the root as written, `../Private` made the day's
 *  note in another space, over whatever was there. */

const { written, template } = vi.hoisted(() => ({
  written: new Map<string, string>(),
  template: { folder: '' },
}))

vi.mock('@nib/bases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nib/bases')>()),
  repeatDue: () => ({ day: '2026-10-24', missed: [] }),
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [],
    activeSpace: { id: 'shared', name: 'Shared', root: '/s/Shared' },
    documentAt: () => null,
    freeName: (_dir: string, wanted: string) => wanted,
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

const { repeatTemplates } = await import('./running')

beforeEach(() => {
  written.clear()
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
