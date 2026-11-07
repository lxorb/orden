import { describe, expect, test } from 'vitest'
import { type Row, todayOf } from '@orden/bases'
import { scanNote, type ScannedNote, type SpaceLinks } from '@orden/scan/note'
import { scanRows } from '@orden/bases/scan'
import { type Host, type RowsChange, RowsStore } from './store'

const WORK = '/spaces/Work'
const HOME = '/spaces/Home'

function scanned(path: string, content: string): ScannedNote {
  return {
    ...scanNote(path, content),
    ...scanRows(content),
    stamp: { size: content.length, mtime: 1, ctime: 1 },
  }
}

interface Rig {
  store: RowsStore
  disk: Map<string, string>
  heard: RowsChange[]
  answer: (root: string) => void
  settled: () => Promise<void>
}

function rig(
  disk: Record<string, string>,
  open: string | null = null,
  vaults: readonly string[] = [],
  more: Partial<Host> = {},
): Rig {
  const files = new Map(Object.entries(disk))
  const waiting = new Map<string, () => void>()
  const notesOf = (root: string) =>
    [...files]
      .filter(([path]) => path.startsWith(`${root}/`))
      .map(([path, text]) => scanned(path.slice(root.length + 1), text))

  const host: Host = {
    scan: (root) =>
      new Promise<SpaceLinks>((go) => {
        const answer = () => go({ notes: notesOf(root), files: [] })
        if ([WORK, HOME].includes(root)) waiting.set(root, answer)
        else answer()
      }),
    read: (path) => Promise.resolve(files.get(path) ?? null),
    open: () => ({
      root: open,
      scanned: () => Promise.resolve(),
      notes: () => (open ? notesOf(open) : []),
    }),
    breathe: () => Promise.resolve(),
    now: () => 42,
    vault: (root) => Promise.resolve(vaults.includes(root)),
    ...more,
  }

  const store = new RowsStore(host)
  const heard: RowsChange[] = []
  store.watch((change) => heard.push(change))

  const settled = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  }

  return {
    store,
    disk: files,
    heard,
    answer: (root) => {
      waiting.get(root)?.()
      waiting.delete(root)
    },
    settled,
  }
}

const tasks = (rows: readonly Row[]) =>
  rows
    .filter((row) => row.kind === 'task')
    .map((row) => `${row.space}:${row.path}:${row.task?.text}`)

describe('the rows of every space', () => {
  test('take what the account says of a note kept away', async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Ship it\n' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()

    store.indexed(WORK, [
      scanned('Away.md', '- [ ] Call the bank\n'),
      scanNote('Bare.md', '- [ ] Not a row\n'),
    ])
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Ship it', 'Work:Away.md:Call the bank'])
    store.indexed(HOME, [scanned('Elsewhere.md', "- [ ] Nobody's\n")])
    expect(tasks(store.of())).toHaveLength(2)
  })

  test('a thousand notes the account indexes at once tell a settled listener once', async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Ship it\n' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()

    let told = 0
    let seen = 0
    const stop = store.settled(() => {
      told += 1
      seen = store.of().length
    })
    store.indexed(
      WORK,
      Array.from({ length: 1000 }, (_, at) => scanned(`Away ${at}.md`, `- [ ] Task ${at}\n`)),
    )
    expect(told).toBe(0)
    await Promise.resolve()
    expect(told).toBe(1)
    expect(seen).toBe(store.of().length)

    stop()
    store.indexed(WORK, [scanned('Late.md', '- [ ] Late\n')])
    await settled()
    expect(told).toBe(1)
  })

  test("an Obsidian vault's tasks say their 📅 is a deadline", async () => {
    const { store, answer, settled } = rig(
      {
        [`${WORK}/Plan.md`]: '- [ ] Ship it 📅 2026-10-06\n',
        [`${HOME}/Errands.md`]: '- [ ] Descale 📅 2026-10-06\n',
      },
      null,
      [HOME],
    )
    store.spacesAre([
      { root: WORK, name: 'Work' },
      { root: HOME, name: 'Home' },
    ])
    await settled()
    answer(WORK)
    await settled()
    answer(HOME)
    await settled()

    const reads = () =>
      store
        .of()
        .filter((row) => row.task)
        .map((row) => [row.task?.text, row.task?.dueReads])
    expect(reads()).toEqual([
      ['Ship it', undefined],
      ['Descale', 'deadline'],
    ])

    store.saved(`${HOME}/Errands.md`, '- [ ] Descale 📅 2026-10-07\n- [ ] Oil 📅 2026-10-08\n')
    expect(reads()).toEqual([
      ['Ship it', undefined],
      ['Descale', 'deadline'],
      ['Oil', 'deadline'],
    ])
  })

  test("the open space's rows are the link index's scan, and the others are read after", async () => {
    const { store, answer, settled } = rig(
      {
        [`${WORK}/Plan.md`]: '- [ ] Ship it 📅 2026-10-06\n',
        [`${HOME}/Errands.md`]: '# Kitchen\n- [ ] Descale\n',
      },
      WORK,
    )

    store.spacesAre([
      { root: WORK, name: 'Work' },
      { root: HOME, name: 'Home' },
    ])
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Ship it'])
    expect(store.ready).toBe(false)

    answer(HOME)
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Ship it', 'Home:Errands.md:Descale'])
    expect(store.of('Home')[1]?.task?.section).toEqual(['Kitchen'])
    expect(store.of(HOME)).toBe(store.of(HOME))
    expect(store.ready).toBe(true)
  })

  test('a note saved is read again from what was written, and said once', async () => {
    const { store, heard, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] One\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    heard.length = 0

    store.saved(`${WORK}/Plan.md`, '---\nstatus: open\n---\n- [x] One\n- [ ] Two\n')

    expect(tasks(store.of())).toEqual(['Work:Plan.md:One', 'Work:Plan.md:Two'])
    expect(store.of()[0]?.note).toEqual({ status: 'open' })
    expect(store.of()[1]?.task?.done).toBe(true)
    expect(store.of()[1]?.anchor?.line).toBe(3)
    expect(heard).toHaveLength(1)
    expect(heard[0]?.path).toBe('Plan.md')
    expect(heard[0]?.removed).toHaveLength(2)
    expect(heard[0]?.added).toHaveLength(3)
    expect(store.of()[0]?.file.ctime).toBe(1)
    expect(store.of()[0]?.file.mtime).toBe(42)
  })

  test('a note written where it is going before its move is told keeps those rows', async () => {
    const { store, disk, settled } = rig(
      { [`${WORK}/A/Plan.md`]: '- [ ] Read [s](Spec.md)\n' },
      WORK,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    const after = '- [ ] Read [s](../A/Spec.md)\n'
    disk.delete(`${WORK}/A/Plan.md`)
    disk.set(`${WORK}/B/Plan.md`, after)
    store.saved(`${WORK}/B/Plan.md`, after)
    void store.follow({
      op: 'moved',
      from: `${WORK}/A/Plan.md`,
      to: `${WORK}/B/Plan.md`,
      kind: 'file',
      root: WORK,
    })

    expect(tasks(store.of())).toEqual(['Work:B/Plan.md:Read [s](../A/Spec.md)'])
    expect(store.of().map((row) => row.file.ctime)).toEqual([1, 1])
  })

  test('a note that links to itself shows the new link once it is renamed', async () => {
    const { store, disk, settled } = rig(
      { [`${WORK}/Plan.md`]: '---\nsee: "[[Plan]]"\n---\n- [ ] Read [[Plan]]\n' },
      WORK,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    const after = '---\nsee: "[[Road]]"\n---\n- [ ] Read [[Road]]\n'
    disk.delete(`${WORK}/Plan.md`)
    disk.set(`${WORK}/Road.md`, after)
    store.saved(`${WORK}/Road.md`, after)
    void store.follow({
      op: 'moved',
      from: `${WORK}/Plan.md`,
      to: `${WORK}/Road.md`,
      kind: 'file',
      root: WORK,
    })

    expect(store.of().map((row) => row.path)).toEqual(['Road.md', 'Road.md'])
    const link = { kind: 'link', target: 'Road' }
    expect(store.of().map((row) => row.note.see)).toEqual([link, link])
    expect(tasks(store.of())).toEqual(['Work:Road.md:Read [[Road]]'])
  })

  test('a renamed or moved note says where it was, so it is not taken for a note just made', async () => {
    const { store, heard, settled } = rig(
      { [`${WORK}/Projects/Launch.md`]: '---\nstatus: Doing\n---\n' },
      WORK,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    heard.length = 0

    void store.follow({
      op: 'moved',
      from: `${WORK}/Projects/Launch.md`,
      to: `${WORK}/Projects/Launch v2.md`,
      kind: 'file',
      root: WORK,
    })
    const there = heard.find((one) => one.path === 'Projects/Launch v2.md')
    expect(there?.added).toHaveLength(1)
    expect(there?.from).toMatchObject({ space: 'Work', path: 'Projects/Launch.md' })
    expect(there?.from?.rows[0]?.note).toEqual({ status: 'Doing' })

    heard.length = 0
    void store.follow({
      op: 'moved',
      from: `${WORK}/Projects`,
      to: `${WORK}/Archive/Projects`,
      kind: 'folder',
      root: WORK,
    })
    const moved = heard.find((one) => one.path === 'Archive/Projects/Launch v2.md')
    expect(moved?.from?.path).toBe('Projects/Launch v2.md')
    store.saved(`${WORK}/New.md`, 'x\n')
    expect(heard.at(-1)?.from).toBeUndefined()
  })

  test('a note made, moved into a folder and removed takes its rows each way', async () => {
    const { store, disk, settled } = rig({}, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    disk.set(`${WORK}/New.md`, '- [ ] Fresh\n')
    await store.follow({ op: 'created', path: `${WORK}/New.md`, kind: 'file', root: WORK })
    expect(tasks(store.of())).toEqual(['Work:New.md:Fresh'])

    void store.follow({
      op: 'moved',
      from: `${WORK}/New.md`,
      to: `${WORK}/Done/Old.md`,
      kind: 'file',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Work:Done/Old.md:Fresh'])
    expect(store.of()[0]?.file).toMatchObject({ name: 'Old.md', basename: 'Old', folder: 'Done' })

    void store.follow({
      op: 'moved',
      from: `${WORK}/Done`,
      to: `${WORK}/Archive`,
      kind: 'folder',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Work:Archive/Old.md:Fresh'])

    void store.follow({ op: 'removed', path: `${WORK}/Archive`, kind: 'folder', root: WORK })
    expect(store.of()).toEqual([])
  })

  test("a note moved to another space is that space's now", async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Go\n' }, WORK)
    store.spacesAre([
      { root: WORK, name: 'Work' },
      { root: HOME, name: 'Home' },
    ])
    await settled()
    answer(HOME)
    await settled()

    void store.follow({
      op: 'moved',
      from: `${WORK}/Plan.md`,
      to: `${HOME}/Plan.md`,
      kind: 'file',
      root: WORK,
    })
    expect(tasks(store.of())).toEqual(['Home:Plan.md:Go'])
    const [, moved] = store.of()
    expect(moved && store.rootOf(moved)).toBe(HOME)
  })

  test('what happens while a space is being read is done again over what it brings back', async () => {
    const { store, disk, answer, settled } = rig({
      [`${HOME}/Kept.md`]: '- [ ] Kept\n',
      [`${HOME}/Gone.md`]: '- [ ] Gone\n',
      [`${HOME}/Old/Moved.md`]: '- [ ] Moved\n',
    })
    store.spacesAre([{ root: HOME, name: 'Home' }])
    await settled()

    store.saved(`${HOME}/Kept.md`, '- [x] Kept\n')
    void store.follow({ op: 'removed', path: `${HOME}/Gone.md`, kind: 'file', root: HOME })
    disk.delete(`${HOME}/Old/Moved.md`)
    disk.set(`${HOME}/New/Moved.md`, '- [ ] Moved\n')
    await store.follow({
      op: 'moved',
      from: `${HOME}/Old`,
      to: `${HOME}/New`,
      kind: 'folder',
      root: HOME,
    })
    disk.set(`${HOME}/Gone.md`, '- [ ] Gone\n')
    disk.set(`${HOME}/Old/Moved.md`, '- [ ] Moved\n')
    disk.delete(`${HOME}/New/Moved.md`)

    answer(HOME)
    await settled()
    expect(tasks(store.of()).sort()).toEqual(['Home:Kept.md:Kept', 'Home:New/Moved.md:Moved'])
    expect(
      store.of().find((row) => row.path === 'Kept.md' && row.kind === 'task')?.task?.done,
    ).toBe(true)
  })

  test('a space renamed keeps its rows under its new name, and one gone takes them', async () => {
    const { store, heard, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Go\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    store.spacesAre([{ root: WORK, name: 'Job' }])
    expect(tasks(store.of())).toEqual(['Job:Plan.md:Go'])
    expect(heard.at(-1)?.path).toBeNull()

    void store.follow({ op: 'moved', from: WORK, to: '/spaces/Job', kind: 'space', root: null })
    expect(store.at('/spaces/Job/Plan.md')).toHaveLength(2)

    store.spacesAre([])
    expect(store.of()).toEqual([])
    expect(heard.at(-1)?.removed).toHaveLength(2)
  })

  test('a sub-task knows its parent, and a heading ends the run', async () => {
    const { store, settled } = rig(
      { [`${WORK}/Plan.md`]: '- [ ] A\n  - [ ] B\n    - [ ] C\n  - [ ] D\n## Next\n  - [ ] E\n' },
      WORK,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()

    const parents = store
      .of()
      .filter((row) => row.task)
      .map((row) => [row.task?.text, row.task?.parent])
    expect(parents).toEqual([
      ['A', undefined],
      ['B', 0],
      ['C', 1],
      ['D', 0],
      ['E', undefined],
    ])
  })

  test('a note the index read again without its rows is read once more', async () => {
    const files = { [`${WORK}/Plan.md`]: '- [ ] Saved since\n' }
    const { store, settled } = rig(files, WORK)
    const host = (store as unknown as { host: Host }).host
    const open = host.open.bind(host)
    host.open = () => ({ ...open(), notes: () => [scanNote('Plan.md', '- [ ] Saved since\n')] })

    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Plan.md:Saved since'])
  })
})

describe('a space’s AGENTS.md, which its settings edit', () => {
  test('makes no row, and one in a folder makes its rows', async () => {
    const { store, answer, settled } = rig({
      [`${WORK}/AGENTS.md`]: '- [ ] Top\n',
      [`${WORK}/sub/AGENTS.md`]: '- [ ] Nested\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()

    const said = [...new Set(store.of('Work').map((row) => row.file.path))]
    expect(said).toEqual(['sub/AGENTS.md'])

    store.saved(`${WORK}/AGENTS.md`, '- [ ] Again\n')
    expect([...new Set(store.of('Work').map((row) => row.file.path))]).toEqual(['sub/AGENTS.md'])
  })
})

describe("a space's own notes, which no scan reads (#1044)", () => {
  const INBOX = '.Inbox.md'

  function hidden(disk: Record<string, string>) {
    const files = new Map(Object.entries(disk))
    const host: Host = {
      scan: (root) =>
        Promise.resolve({
          notes: [...files]
            .filter(([path]) => path.startsWith(`${root}/`) && !path.includes('/.'))
            .map(([path, text]) => scanned(path.slice(root.length + 1), text)),
          files: [],
        }),
      read: (path) => Promise.resolve(files.get(path) ?? null),
      open: () => ({ root: null, scanned: () => Promise.resolve(), notes: () => [] }),
      breathe: () => Promise.resolve(),
      now: () => 42,
      vault: () => Promise.resolve(false),
      own: () => [INBOX],
    }
    return { store: new RowsStore(host), files }
  }

  const settle = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  }

  test('are read with their space: their tasks are rows, and they are no note', async () => {
    const { store } = hidden({
      [`${WORK}/Plan.md`]: '- [ ] Write the plan\n',
      [`${WORK}/${INBOX}`]: '- [ ] Call the bank\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settle()

    expect(tasks(store.of('Work'))).toEqual([
      'Work:Plan.md:Write the plan',
      `Work:${INBOX}:Call the bank`,
    ])
    expect(
      store
        .of('Work')
        .filter((row) => row.kind === 'note')
        .map((row) => row.path),
    ).toEqual(['Plan.md'])
    expect(store.at(`${WORK}/${INBOX}`).map((row) => row.task?.text)).toEqual(['Call the bank'])
  })

  test('are kept current by a save, as any note is', async () => {
    const { store } = hidden({ [`${WORK}/Plan.md`]: '' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settle()
    expect(tasks(store.of('Work'))).toEqual([])

    store.saved(`${WORK}/${INBOX}`, '- [ ] Buy milk\n- [x] Post the letter\n')
    expect(tasks(store.of('Work'))).toEqual([
      `Work:${INBOX}:Buy milk`,
      `Work:${INBOX}:Post the letter`,
    ])
    expect(
      store
        .of('Work')
        .filter((row) => row.kind === 'note')
        .map((row) => row.path),
    ).toEqual(['Plan.md'])
  })
})

describe('the rows a view shows', () => {
  test('leave out every note that is protected and shut, and only those', async () => {
    const { store, answer, settled } = rig({
      [`${WORK}/Plan.md`]: '- [ ] Ship it\n',
      [`${WORK}/Diary/Mine.md`]: '- [ ] Call her\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()

    const shut = (path: string) => path.startsWith(`${WORK}/Diary/`)
    expect(tasks(store.openOf(undefined, shut))).toEqual(['Work:Plan.md:Ship it'])
    expect(tasks(store.openOf('Work', () => false))).toHaveLength(2)
  })
})

describe('the rows of a todo list and of a note (#1229, #1228)', () => {
  function listed(disk: Record<string, string>, now?: () => number) {
    const meta = new Map<string, Record<string, string>>([['Errands.md', { 'todo-list': 'yes' }]])
    const dated: [string, Record<string, string | null>][] = []
    const made = rig(disk, null, [], {
      ...(now ? { now } : {}),
      meta: (_root, path) => meta.get(path) ?? null,
      list: (_root, path, said) => path === '.Inbox.md' || said?.['todo-list'] === 'yes',
      dated: (_root, path, patch) => {
        dated.push([path, patch])
        const now = Object.entries({ ...meta.get(path), ...patch }).filter(
          (one): one is [string, string] => one[1] !== null,
        )
        meta.set(path, Object.fromEntries(now))
      },
    })
    return { ...made, meta, dated }
  }

  test('a checkbox in a note is no task, and one in a list is', async () => {
    const { store, answer, settled } = listed({
      [`${WORK}/Errands.md`]: '- [ ] Post the letter\n',
      [`${WORK}/Meeting.md`]: '- [ ] Ask about the budget\n',
      [`${WORK}/Projects/Notes.md`]: '- [ ] Not a todo either\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    expect(tasks(store.of())).toEqual(['Work:Errands.md:Post the letter'])
    store.saved(`${WORK}/Meeting.md`, '- [x] Ask about the budget\n')
    expect(tasks(store.of())).toEqual(['Work:Errands.md:Post the letter'])
  })

  test('ticking a todo keeps its date as the list’s metadata, its words untouched', async () => {
    const { store, answer, settled, dated, disk } = listed({
      [`${WORK}/Errands.md`]: '- [ ] Post the letter\n',
      [`${WORK}/Meeting.md`]: '- [ ] Ask about the budget\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    disk.set(`${WORK}/Errands.md`, '- [x] Post the letter\n')
    store.saved(`${WORK}/Errands.md`, '- [x] Post the letter\n')
    store.saved(`${WORK}/Meeting.md`, '- [x] Ask about the budget\n')
    expect(dated.map(([path]) => path)).toEqual(['Errands.md'])
    store.described(`${WORK}/Errands.md`)
    await settled()
    const done = store.of().find((row) => row.task?.text === 'Post the letter')
    expect(done?.task?.completed).toBe(todayOf(new Date(42)))
    expect(done?.task?.text).toBe('Post the letter')
  })

  test('a todo ticked on another device takes no day here: the device that ticked it keeps it', async () => {
    const path = `${WORK}/Errands.md`
    const { store, answer, settled, dated, disk } = listed({
      [path]: '- [ ] Post the letter\n- [ ] Call mom\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    disk.set(path, '- [x] Post the letter\n- [ ] Call mom\n')
    store.saved(path, '- [x] Post the letter\n- [ ] Call mom\n', false)
    disk.set(path, '- [x] Post the letter\n- [x] Call mom\n')
    await store.follow({ op: 'created', path, kind: 'file', root: WORK, heard: true })
    await settled()
    expect(dated).toEqual([])
    expect(tasks(store.of())).toHaveLength(2)
  })

  test('two todos with the same words keep their own dates, ticked here or on another device (#1401)', async () => {
    const path = `${WORK}/Errands.md`
    const first = new Date(2026, 10, 1, 12).getTime()
    const later = new Date(2026, 10, 5, 12).getTime()
    let clock = first
    const { store, answer, settled, disk } = listed(
      { [path]: '- [ ] Call mom\n- [ ] Call mom\n' },
      () => clock,
    )
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    disk.set(path, '- [ ] Call mom\n- [x] Call mom\n')
    store.saved(path, '- [ ] Call mom\n- [x] Call mom\n')
    clock = later
    disk.set(path, '- [x] Call mom\n- [x] Call mom\n')
    await store.follow({ op: 'created', path, kind: 'file', root: WORK })
    store.described(path)
    await settled()
    const days = store
      .of()
      .filter((row) => row.task)
      .map((row) => row.task?.completed)
    expect(days).toEqual([todayOf(new Date(later)), todayOf(new Date(first))])
  })

  test('a done todo moved to another list keeps the day it was done, not the day it moved', async () => {
    const from = `${WORK}/Errands.md`
    const to = `${WORK}/Groceries.md`
    const first = new Date(2026, 10, 1, 12).getTime()
    const later = new Date(2026, 10, 5, 12).getTime()
    let clock = first
    const { store, answer, settled, disk, meta } = listed(
      { [from]: '- [ ] Buy soil\n- [x] Weed\n', [to]: '- [ ] Milk\n' },
      () => clock,
    )
    meta.set('Groceries.md', { 'todo-list': 'yes' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    disk.set(from, '- [x] Buy soil\n- [x] Weed\n')
    store.saved(from, '- [x] Buy soil\n- [x] Weed\n')
    store.described(from)
    await settled()

    clock = later
    disk.set(from, '- [x] Weed\n')
    store.saved(from, '- [x] Weed\n')
    disk.set(to, '- [x] Buy soil\n- [ ] Milk\n')
    store.saved(to, '- [x] Buy soil\n- [ ] Milk\n')
    store.described(to)
    await settled()

    const moved = store.of().find((row) => row.task?.text === 'Buy soil')
    expect(moved?.path).toBe('Groceries.md')
    expect(moved?.task?.completed).toBe(todayOf(new Date(first)))
    disk.set(to, '- [x] Buy soil\n- [ ] Milk\n- [x] Weed\n')
    store.saved(to, '- [x] Buy soil\n- [ ] Milk\n- [x] Weed\n')
    store.described(to)
    await settled()
    const typed = store.of().find((row) => row.path === 'Groceries.md' && row.task?.text === 'Weed')
    expect(typed?.task?.completed).toBe(todayOf(new Date(later)))
  })
})
