import { describe, expect, test } from 'vitest'
import type { Row } from '@orden/bases'
import { scanNote, type ScannedNote, type SpaceLinks } from '@orden/scan/note'
import { scanRows } from '@orden/bases/scan'
import { type Host, type RowsChange, RowsStore } from './store'

const WORK = '/spaces/Work'
const HOME = '/spaces/Home'
const moved = (from: string, to: string, kind: 'file' | 'folder' = 'file') => ({
  op: 'moved' as const,
  from,
  to,
  kind,
  root: WORK,
})
const scanned = (path: string, content: string): ScannedNote => ({
  ...scanNote(path, content),
  ...scanRows(content),
  stamp: { size: content.length, mtime: 1, ctime: 1 },
})
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
  rows.filter((row) => row.kind === 'task').map((row) => `${row.space}:${row.path}:${row.task?.text}`)
describe('the rows of every space', () => {
  test('take what the account says of a note kept away', async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Plan.md`]: '- [ ] Ship it\n' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    answer(WORK)
    await settled()
    store.indexed(WORK, [scanned('Away.md', '- [ ] Call the bank\n'), scanNote('Bare.md', '- [ ] Not a row\n')])
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
    const { store, disk, settled } = rig({ [`${WORK}/A/Plan.md`]: '- [ ] Read [s](Spec.md)\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    const after = '- [ ] Read [s](../A/Spec.md)\n'
    disk.delete(`${WORK}/A/Plan.md`)
    disk.set(`${WORK}/B/Plan.md`, after)
    store.saved(`${WORK}/B/Plan.md`, after)
    void store.follow(moved(`${WORK}/A/Plan.md`, `${WORK}/B/Plan.md`))
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
    void store.follow(moved(`${WORK}/Plan.md`, `${WORK}/Road.md`))
    expect(store.of().map((row) => row.path)).toEqual(['Road.md', 'Road.md'])
    const link = { kind: 'link', target: 'Road' }
    expect(store.of().map((row) => row.note.see)).toEqual([link, link])
    expect(tasks(store.of())).toEqual(['Work:Road.md:Read [[Road]]'])
  })
  test('a renamed or moved note says where it was, so it is not taken for a note just made', async () => {
    const { store, heard, settled } = rig({ [`${WORK}/Projects/Launch.md`]: '---\nstatus: Doing\n---\n' }, WORK)
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    heard.length = 0
    void store.follow(moved(`${WORK}/Projects/Launch.md`, `${WORK}/Projects/Launch v2.md`))
    const there = heard.find((one) => one.path === 'Projects/Launch v2.md')
    expect(there?.added).toHaveLength(1)
    expect(there?.from).toMatchObject({ space: 'Work', path: 'Projects/Launch.md' })
    expect(there?.from?.rows[0]?.note).toEqual({ status: 'Doing' })
    heard.length = 0
    void store.follow(moved(`${WORK}/Projects`, `${WORK}/Archive/Projects`, 'folder'))
    const inside = heard.find((one) => one.path === 'Archive/Projects/Launch v2.md')
    expect(inside?.from?.path).toBe('Projects/Launch v2.md')
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
    void store.follow(moved(`${WORK}/New.md`, `${WORK}/Done/Old.md`))
    expect(tasks(store.of())).toEqual(['Work:Done/Old.md:Fresh'])
    expect(store.of()[0]?.file).toMatchObject({ name: 'Old.md', basename: 'Old', folder: 'Done' })
    void store.follow(moved(`${WORK}/Done`, `${WORK}/Archive`, 'folder'))
    expect(tasks(store.of())).toEqual(['Work:Archive/Old.md:Fresh'])
    void store.follow({ op: 'removed', path: `${WORK}/Archive`, kind: 'folder', root: WORK })
    expect(store.of()).toEqual([])
  })
  test('a note that came from elsewhere is as old as the disk says, and one saved here is new', async () => {
    const stamp = () => Promise.resolve({ mtime: 1_600_000_000_000, ctime: 1_500_000_000_000 })
    const { store, disk, settled } = rig({}, WORK, [], { stamp })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    disk.set(`${WORK}/Old.md`, '# Old\n')
    await store.follow({ op: 'created', path: `${WORK}/Old.md`, kind: 'file', root: WORK })
    expect(store.at(`${WORK}/Old.md`)[0]?.file).toMatchObject({ mtime: 1_600_000_000_000, ctime: 1_500_000_000_000 })
    store.saved(`${WORK}/Old.md`, '# Old, edited\n')
    expect(store.at(`${WORK}/Old.md`)[0]?.file).toMatchObject({ mtime: 42, ctime: 1_500_000_000_000 })
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
    void store.follow(moved(`${WORK}/Plan.md`, `${HOME}/Plan.md`))
    expect(tasks(store.of())).toEqual(['Home:Plan.md:Go'])
    const [, other] = store.of()
    expect(other && store.rootOf(other)).toBe(HOME)
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
    expect(store.of().find((row) => row.path === 'Kept.md' && row.kind === 'task')?.task?.done).toBe(true)
  })
  test('a note saved before its space is first read says its rows before it are not known yet', async () => {
    const { store, heard, answer, settled } = rig({
      [`${WORK}/Bugs/Old.md`]: '---\nstatus: Done\n---\nmore\n',
    })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    await settled()
    store.saved(`${WORK}/Bugs/Old.md`, '---\nstatus: Done\n---\nmore and more\n')
    expect(heard.filter((one) => one.path === 'Bugs/Old.md').map((one) => one.firstRead)).toEqual([true])
    answer(WORK)
    await settled()
    store.saved(`${WORK}/Bugs/Old.md`, '---\nstatus: Done\n---\nless\n')
    store.again(WORK)
    store.saved(`${WORK}/Bugs/Old.md`, '---\nstatus: Done\n---\nless again\n')
    const told = heard.filter((one) => one.path === 'Bugs/Old.md').slice(1)
    expect(told.map((one) => one.firstRead)).toEqual([undefined, undefined])
    expect(told.every((one) => one.removed.length > 0)).toBe(true)
  })
  test('a note saved or read here gives its size in bytes, as the scan of the disk does', async () => {
    const { store, answer, settled } = rig({ [`${WORK}/Notiz.md`]: 'Grüße\n' })
    store.spacesAre([{ root: WORK, name: 'Work' }])
    answer(WORK)
    await settled()
    store.saved(`${WORK}/Notiz.md`, 'Grüße 😀\n')
    const row = store.of().find((one) => one.path === 'Notiz.md')
    expect(row?.file.size).toBe(new TextEncoder().encode('Grüße 😀\n').length)
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
test('a space’s AGENTS.md, which its settings edit makes no row, and one in a folder makes its rows', async () => {
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
test('the rows a view shows leave out every note that is protected and shut, and only those', async () => {
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
