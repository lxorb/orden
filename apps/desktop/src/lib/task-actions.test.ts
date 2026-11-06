import { beforeEach, describe, expect, test, vi } from 'vitest'
import { rowsOfText } from '@orden/bases/rows'
import { todayOf } from '@orden/bases'

const files = new Map<string, string>()
const home = { name: 'Home', root: '/s/Home' }
const work = { name: 'Work', root: '/s/Work' }
const front = vi.hoisted(() => ({ name: 'Home' }))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [home, work],
    shownSpaces: [home, work],
    get activeSpace() {
      return front.name === 'Work' ? work : home
    },
    notes: [],
    recent: [],
    noteText: (path: string) => Promise.resolve(files.get(path) ?? null),
  },
}))

const share = vi.hoisted(() => ({ readOnly: false }))
vi.mock('./sharing.svelte', () => ({
  canWriteAt: () => !share.readOnly,
  roleOf: () => 'owner',
  isShared: () => false,
}))

vi.mock('./workspace/note-text', () => ({
  noteText: (_ws: unknown, path: string) => Promise.resolve(files.get(path) ?? null),
  replaceInNotes: (_ws: unknown, changes: { path: string; after: string }[]) => {
    if (share.readOnly) return Promise.resolve(0)
    for (const one of changes) files.set(one.path, one.after)
    return Promise.resolve(changes.length)
  },
}))

vi.mock('./rows/inbox-note', () => ({
  inboxNote: (root: string) => {
    const path = `${root}/Inbox.md`
    if (!files.has(path)) files.set(path, '')
    return Promise.resolve(path)
  },
}))

vi.mock('./rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
    of: () =>
      [...files].flatMap(([path, text]) => rowsOfText('Home', path.slice('/s/Home/'.length), text)),
    inboxes: () => [{ space: 'Home', path: 'Inbox.md' }],
  },
}))

const { addTask, listed, tickTask } = await import('./task-actions')

const today = todayOf()

beforeEach(() => {
  front.name = 'Home'
  share.readOnly = false
  files.clear()
  files.set('/s/Home/Plan.md', `# Plan\n- [ ] Water the plants 🔁 every day 📅 ${today}\n`)
})

describe("the reader's own task actions", () => {
  test('a line in the inbox, made the first time, its marks read', async () => {
    expect(await addTask('Call Mum ⏫')).toEqual({ path: '/s/Home/Inbox.md', line: 0 })
    expect(files.get('/s/Home/Inbox.md')).toBe('- [ ] Call Mum ⏫\n')
    expect(await addTask('  ')).toBeNull()
  })

  test('words nobody typed are the task, with no marks read out of them', async () => {
    expect(await addTask('Why p1 matters !! tomorrow >Plan', { typed: false })).toEqual({
      path: '/s/Home/Inbox.md',
      line: 0,
    })
    expect(files.get('/s/Home/Inbox.md')).toBe('- [ ] Why p1 matters !! tomorrow >Plan\n')
  })

  test("the reader's one inbox whatever space is open, typed or shared (#1157)", async () => {
    front.name = 'Work'
    expect(await addTask('Call Mum')).toEqual({ path: '/s/Home/Inbox.md', line: 0 })
    expect(await addTask('Read this', { typed: false })).toEqual({
      path: '/s/Home/Inbox.md',
      line: 1,
    })
    expect(files.has('/s/Work/Inbox.md')).toBe(false)
    expect(await addTask('Given', { root: '/s/Work', typed: false })).toEqual({
      path: '/s/Work/Inbox.md',
      line: 0,
    })
  })

  test('a recurring task ticked writes its next line above, in one edit', async () => {
    const { tasks } = await listed()
    expect(tasks.map((one) => one.text)).toEqual(['Water the plants'])
    expect(await tickTask(tasks[0]?.at ?? '', 'Home', true)).toBe(true)
    const lines = files.get('/s/Home/Plan.md')?.split('\n') ?? []
    expect(lines[1]).toMatch(/^- \[ \] Water the plants 🔁 every day 📅 \d{4}-\d{2}-\d{2}$/)
    expect(lines[2]).toBe(`- [x] Water the plants 🔁 every day 📅 ${today} ✅ ${today}`)
  })

  test('nothing ticked in a space shared to be read', async () => {
    const { tasks } = await listed()
    const was = files.get('/s/Home/Plan.md')
    share.readOnly = true

    expect(await tickTask(tasks[0]?.at ?? '', 'Home', true)).toBe(false)
    expect(files.get('/s/Home/Plan.md')).toBe(was)
  })

  test('nothing ticked where the task or the space is not there', async () => {
    expect(await tickTask('Plan.md#1:nothing', 'Home', true)).toBe(false)
    expect(await tickTask('Plan.md#1:nothing', 'Elsewhere', true)).toBe(false)
  })
})
