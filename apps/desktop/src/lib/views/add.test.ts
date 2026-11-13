import { beforeEach, describe, expect, test, vi } from 'vitest'
import { builtinView, groupName, readBase, WHEN_GROUPS } from '@orden/bases'
import { answer } from '@orden/bases/answer'
import { rowsOfText } from '@orden/bases/rows'
import { freePath } from '@orden/markdown/paths'

const { added, written, taken, on, held, ids } = vi.hoisted(() => ({
  added: [] as string[],
  written: new Map<string, string>(),
  taken: new Set<string>(),
  on: { root: '/s/Shared' },
  held: new Map<string, string[]>(),
  ids: new Map<string, string>(),
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
      get notes() {
        const space = on.root === mine.root ? mine : shared
        return (held.get(space.name) ?? []).map((relative) => ({
          path: `${space.root}/${relative}`,
          name: relative.split('/').pop() ?? relative,
        }))
      },
      noteText: async (path: string) => files[path] ?? null,
      freeName: (dir: string, wanted: string) => {
        const keys = new Set([...taken].map((one) => pathKey(one, dir)))
        return freePath(wanted, (candidate) => keys.has(pathKey(`${dir}/${candidate}`, dir)))
      },
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
      protection: { locked: () => false },
    },
  }
})
vi.mock('../workspace/write-file', () => ({
  writeFile: async (path: string, content: string) => void written.set(path, content),
}))

vi.mock('../surfaces.svelte', () => ({ showQuickAdd: () => undefined }))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
    ready: true,
    inbox: async () => '/s/Private/Inbox.md',
    of: (space: string) =>
      (held.get(space) ?? []).map((path) => ({
        kind: 'note',
        space,
        path,
        file: { basename: (path.split('/').pop() ?? path).replace(/\.md$/i, '') },
        note: ids.has(`${space}/${path}`) ? { id: ids.get(`${space}/${path}`) } : {},
      })),
  },
}))
vi.mock('./act', () => ({
  addTask: async (path: string) => void added.push(path),
}))

const { addNote, addTyped, openQuickAdd, prefillOf } = await import('./add')

const inFolder = (folder: string) =>
  readBase(
    `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: table\n    name: T\n`,
  )

beforeEach(() => {
  on.root = '/s/Shared'
  held.clear()
  ids.clear()
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
      `filters:\n  and:\n    - file.inFolder("Inbox")\norden:\n  template: "[[Journal]]"\nviews:\n  - type: table\n    name: T\n`,
    )

  beforeEach(() => {
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

describe('a numbered note added to a base from a tab of another space', () => {
  test("takes the next number of the base's own space, not of the one on screen", async () => {
    on.root = '/s/Private'
    held.set('Shared', ['One.md'])
    held.set('Mine', ['Mine.md'])
    ids.set('Shared/One.md', 'BUG-7')
    ids.set('Mine/Mine.md', 'BUG-40')
    const bugs = readBase(
      'orden:\n  id: { property: id, prefix: BUG }\nviews:\n  - type: table\n    name: T\n',
    )

    const path = await addNote(bugs, 0, '/s/Shared/Bugs.base', undefined, { open: false })

    expect(written.get(path ?? '')).toContain('id: BUG-8')
  })
})

describe('a task added in a group of Todos', () => {
  const todos = { builtin: 'todos' as const, space: 'Mine' }
  const today = '2026-10-13'

  test('is due today or tomorrow, or wears the label', () => {
    on.root = '/s/Private'
    expect(prefillOf(todos, today, { property: 'formula.when', key: 'today' })).toEqual({
      deadline: today,
    })
    expect(prefillOf(todos, today, { property: 'formula.when', key: 'tomorrow' })).toEqual({
      deadline: '2026-10-14',
    })
    expect(prefillOf(todos, today, { property: 'formula.when', key: null })).toEqual({})
    expect(prefillOf(todos, today, { property: 'task.tags', key: 'home' })).toEqual({
      tags: ['home'],
    })
    expect(prefillOf(todos, today, { property: 'file.path', key: 'Errands.md' })).toEqual({})
  })

  test('in a tab of another space goes to the one inbox', async () => {
    added.length = 0
    const prefill = prefillOf(todos, today)
    expect(openQuickAdd(prefill)).toBe(true)
    await addTyped('Pay', prefill)
    expect(added).toEqual(['/s/Private/Inbox.md'])
  })

  test('of one space goes to the one inbox though it is the open one (#1153)', async () => {
    on.root = '/s/Private'
    added.length = 0
    const prefill = prefillOf(todos, today)
    expect(openQuickAdd(prefill)).toBe(true)
    await addTyped('Pay', prefill)
    expect(added).toEqual(['/s/Private/Inbox.md'])
  })

  test('of every space names no space, so quick add takes it to the one inbox (#1153)', () => {
    expect(prefillOf({ builtin: 'todos' }, today)).toEqual({})
    expect(openQuickAdd({})).toBe(true)
  })

  test('of every space narrowed to one still goes to the one inbox (#1153, #2103)', () => {
    expect(prefillOf({ builtin: 'todos' }, today, undefined, { space: 'Mine' })).toEqual({})
  })

  test('a label of another space too, and with two of that name, nowhere it could not know', async () => {
    added.length = 0
    await addTyped('Pay', prefillOf({ builtin: 'label', tag: 'x', space: 'Mine' }, today))
    expect(added).toEqual(['/s/Private/Inbox.md'])
    expect(prefillOf({ builtin: 'label', tag: 'x' }, today)).toEqual({ tags: ['x'] })
  })
})

describe('a task added from the add row of a group of Todos or Upcoming (#1248)', () => {
  const today = '2026-10-13'
  const context = { today, now: `${today}T10:00:00` }

  const landsIn = (view: 'todos' | 'upcoming', prefill: ReturnType<typeof prefillOf>) => {
    const line = [
      '- [ ] New',
      prefill.due ? `📅 ${prefill.due}` : '',
      prefill.deadline ? `[deadline:: ${prefill.deadline}]` : '',
    ]
      .filter(Boolean)
      .join(' ')
    const rows = rowsOfText('Mine', 'Inbox.md', `${line}\n`)
    const groups = answer(builtinView(view), 0, rows, context).groups
    const key = groups.find((group) => group.rows.length)?.key
    return key === undefined ? 'gone' : groupName(key)
  }

  test('in Todos stays in its group, and under Overdue is due today', () => {
    const at = (key: string) =>
      landsIn('todos', prefillOf({ builtin: 'todos' }, today, { property: 'formula.when', key }))
    expect(WHEN_GROUPS.map(at)).toEqual(['today', 'today', 'tomorrow', 'later'])
  })

  test('in Upcoming stays in its day, and under Overdue is for today, so it never vanishes', () => {
    const at = (key: string) =>
      landsIn(
        'upcoming',
        prefillOf({ builtin: 'upcoming' }, today, { property: 'formula.day', key }),
      )
    expect(['overdue', today, '2026-10-20'].map(at)).toEqual([today, today, '2026-10-20'])
  })

  test('in Todos narrowed by Display wears what the view asks for, so it is not filtered out', () => {
    on.root = '/s/Private'
    const only = { label: 'home', priority: 1 as const, date: 'today' as const, assignee: 'Emil' }
    expect(
      prefillOf({ builtin: 'todos' }, today, { property: 'task.tags', key: 'work' }, only),
    ).toEqual({ tags: ['home', 'work'], priority: 1, due: today, assignee: 'Emil' })
    expect(prefillOf({ builtin: 'todos' }, today, undefined, { assignee: ':none' })).toEqual({})
  })
})
