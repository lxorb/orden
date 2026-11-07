import { beforeEach, describe, expect, test, vi } from 'vitest'

const { written, template, moved, plan, before, writing, trusted, ran } = vi.hoisted(() => ({
  trusted: { yes: true },
  ran: [] as { base: { guarded?: boolean } }[][],
  writing: { pairs: [] as unknown[], changed: true },
  before: [] as unknown[][],
  written: new Map<string, string>(),
  template: { folder: '' },
  moved: [] as string[],
  plan: { folder: '' },
}))

vi.mock('@orden/bases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/bases')>()),
  repeatDue: (note: { made?: unknown }) =>
    note.made === '2026-10-24' ? null : { day: '2026-10-24', missed: [] },
  readBase: () => ({ orden: { id: 'tasks' } }),
  readAutomations: () => [],
}))
vi.mock('./automate', () => ({
  planned: (bases: { base: { guarded?: boolean } }[], removed: unknown[]) => {
    before.push(removed)
    ran.push(bases)
    return {
      writes: writing.pairs,
      moves: plan.folder
        ? [{ row: { space: 'Shared', path: 'Inbox/a.md' }, folder: plan.folder }]
        : [],
      notices: [],
    }
  },
}))
vi.mock('./act', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./act')>()),
  writeEach: async () => writing.changed,
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'shared', name: 'Shared', root: '/s/Shared' }],
    move: async (from: string, to: string) => void moved.push(`${from} -> ${to}`),
    activeSpace: { id: 'shared', name: 'Shared', root: '/s/Shared' },
    documentAt: () => null,
    freeName: (_dir: string, wanted: string) => wanted,
    freeNameOnDisk: (dir: string, wanted: string) =>
      Promise.resolve(written.has(`${dir}/${wanted}`) ? wanted.replace(/\.md$/, ' 2.md') : wanted),
    fileCame: async () => undefined,
    noteText: async (path: string) => written.get(path) ?? '---\nrepeat: daily\n---\n',
    loadTree: async () => undefined,
  },
}))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
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
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true, trustsHtmlAt: () => trusted.yes }))

const { heard, heardChange, readHeld, repeatTemplates } = await import('./running')
const { BASES_WORD, hiddenKinds } = await import('../settings.svelte')
hiddenKinds.hidden = [BASES_WORD]
const { moving } = await import('./moving')

beforeEach(() => {
  before.length = 0
  written.clear()
  moved.length = 0
})

describe('a base somebody else could have written', () => {
  test('runs under the guard any other reader of it runs under', async () => {
    plan.folder = ''
    trusted.yes = false
    ran.length = 0
    try {
      await readHeld('/s/Shared/Tasks.base')
      heard('Shared', 'Inbox/a.md', [])
      await new Promise((done) => setTimeout(done, 150))
    } finally {
      trusted.yes = true
    }
    expect(ran.at(-1)?.map((one) => one.base.guarded)).toEqual([true])
  })
})

describe("a base's automation that moves a note", () => {
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

describe("a base's automation that writes a note", () => {
  async function changed(path: string) {
    await readHeld('/s/Shared/Tasks.base')
    writing.pairs = [{ row: { space: 'Shared', path }, change: {} }]
    heard('Shared', path, [])
    await new Promise((done) => setTimeout(done, 150))
    writing.pairs = []
  }

  test('takes the next change for its own, when its write changed the note', async () => {
    plan.folder = ''
    writing.changed = true
    await changed('Inbox/one.md')
    expect(before).toHaveLength(1)

    await changed('Inbox/one.md')
    expect(before).toHaveLength(1)

    await changed('Inbox/one.md')
    expect(before).toHaveLength(2)
  })

  test('and not when its write changed nothing, since none is coming', async () => {
    plan.folder = ''
    writing.changed = false
    await changed('Inbox/two.md')
    await changed('Inbox/two.md')

    expect(before).toHaveLength(2)
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

  test('is made once, while two windows make them at once or one still holds the old rows', async () => {
    template.folder = 'Journal'
    await Promise.all([repeatTemplates(), repeatTemplates()])
    await repeatTemplates()

    expect([...written.keys()].filter((path) => !path.includes('/Templates/'))).toEqual([
      '/s/Shared/Journal/Daily 2026-10-24.md',
    ])
    expect(written.get('/s/Shared/Templates/Daily.md')).toContain('made: 2026-10-24')
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
