import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row } from '@orden/bases'
import { scanRows } from '@orden/bases/scan'
import { scanNote, type SpaceLinks } from '@orden/scan/note'

const ROOT = '/space'

const held = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  folders: new Set<string>(),
}))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
})

vi.mock('../link-index.svelte', () => ({
  links: { scanned: () => Promise.resolve(), rootOf: () => ROOT, held: () => [] },
}))

vi.mock('../workspace.svelte', async () => {
  const { ItemMetaStore } = await import('../workspace/item-meta.svelte')
  return {
    workspace: {
      itemMeta: new ItemMetaStore(() => ROOT),
      get notes() {
        return [...held.disk.keys()].map((path) => ({ path, name: path.split('/').pop() }))
      },
      rootHolding: () => ROOT,
      entryAt: (path: string) => (held.folders.has(path) ? { path, is_dir: true } : null),
    },
  }
})

const { workspace } = await import('../workspace.svelte')
const { RowsStore } = await import('./store')
const { listedAt, listNamed, listsIn, unmakeList } = await import('./todo-lists')
const { hearOldLists, markOldListsSoon } = await import('./old-lists')

const OLD_SPACE = {
  'Projects/Garden.md': '- [ ] Plant the tulips\n- [x] Buy soil\n',
  'Projects/Work/Work.md': '- [ ] Send the report\n',
  'Projects/Work/Hiring.md': '- [ ] Call Ana\n- [ ] Write the ad\n',
  'Diary.md': '- [ ] Only a checkbox\n',
  '.Inbox.md': '- [ ] Milk\n',
}

function seed(notes: Record<string, string>) {
  for (const [path, text] of Object.entries(notes)) held.disk.set(`${ROOT}/${path}`, text)
  held.folders.add(`${ROOT}/Projects`)
  held.folders.add(`${ROOT}/Projects/Work`)
}

async function settled() {
  for (let turn = 0; turn < 30; turn++) await new Promise((done) => setTimeout(done, 0))
}

async function rowsStore() {
  const store = new RowsStore({
    scan: () =>
      Promise.resolve<SpaceLinks>({
        notes: [...held.disk].map(([path, text]) => ({
          ...scanNote(path.slice(ROOT.length + 1), text),
          ...scanRows(text),
          stamp: { size: text.length, mtime: 1, ctime: 1 },
        })),
        files: [],
      }),
    read: (path) => Promise.resolve(held.disk.get(path) ?? null),
    open: () => ({ root: null, scanned: () => Promise.resolve(), notes: () => [] }),
    breathe: () => Promise.resolve(),
    now: () => 42,
    vault: () => Promise.resolve(false),
    meta: (root, path) => workspace.itemMeta.itemsOf(root)[path] ?? null,
    list: (root, path, meta) => listedAt(root, path, meta),
  })
  workspace.itemMeta.hear((path) => store.described(path))
  hearOldLists((paths) => {
    for (const path of paths) store.described(path)
  })
  store.spacesAre([{ root: ROOT, name: 'Space' }])
  await settled()
  return store
}

const tasks = (rows: readonly Row[]) =>
  rows
    .filter((row) => row.kind === 'task')
    .map((row) => `${row.path}:${row.task?.text}`)
    .sort()

const OLD_TASKS = [
  '.Inbox.md:Milk',
  'Projects/Garden.md:Buy soil',
  'Projects/Garden.md:Plant the tulips',
  'Projects/Work/Hiring.md:Call Ana',
  'Projects/Work/Hiring.md:Write the ad',
  'Projects/Work/Work.md:Send the report',
]

beforeEach(() => {
  held.disk.clear()
  held.folders.clear()
  stored.clear()
  workspace.itemMeta.forget(ROOT)
})

describe('a space made before todo lists were marked (#1333)', () => {
  test('keeps the same lists, todos and counts once its old lists are marked', async () => {
    seed(OLD_SPACE)
    const store = await rowsStore()
    const lists = () => listsIn(ROOT).sort()

    expect(tasks(store.of())).toEqual(OLD_TASKS)
    expect(lists()).toEqual([
      '.Inbox.md',
      'Projects/Garden.md',
      'Projects/Work/Hiring.md',
      'Projects/Work/Work.md',
    ])

    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(workspace.itemMeta.listsMarked(ROOT)).toBe(true)
    expect(workspace.itemMeta.of(`${ROOT}/Projects/Garden.md`)).toEqual({ 'todo-list': 'yes' })
    expect(workspace.itemMeta.of(`${ROOT}/Projects/Work/Hiring.md`)).toEqual({
      'todo-list': 'yes',
    })
    expect(workspace.itemMeta.of(`${ROOT}/Diary.md`)).toBeNull()
    expect(workspace.itemMeta.of(`${ROOT}/Projects`)).toEqual({ 'todo-lists': 'marked' })
    expect(tasks(store.of())).toEqual(OLD_TASKS)
    expect(lists()).toEqual([
      '.Inbox.md',
      'Projects/Garden.md',
      'Projects/Work/Hiring.md',
      'Projects/Work/Work.md',
    ])
  })

  test('quick add into an existing project finds it, before and after the marking', async () => {
    seed(OLD_SPACE)
    expect(listNamed(ROOT, 'Garden')).toBe('Projects/Garden.md')
    expect(listNamed(ROOT, 'Hiring')).toBe('Projects/Work/Hiring.md')

    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(listNamed(ROOT, 'Garden')).toBe('Projects/Garden.md')
    expect(listNamed(ROOT, 'Hiring')).toBe('Projects/Work/Hiring.md')
    expect(listNamed(ROOT, 'Diary')).toBe('Projects/Diary.md')
  })

  test('a list moved out of Projects later stays a list, and a checkbox note stays a note', async () => {
    seed(OLD_SPACE)
    markOldListsSoon(ROOT, true, workspace)
    await settled()

    workspace.itemMeta.moved(`${ROOT}/Projects/Garden.md`, `${ROOT}/Garden.md`)
    held.disk.set(`${ROOT}/Garden.md`, held.disk.get(`${ROOT}/Projects/Garden.md`) ?? '')
    held.disk.delete(`${ROOT}/Projects/Garden.md`)

    expect(listedAt(ROOT, 'Garden.md')).toBe(true)
    expect(listedAt(ROOT, 'Diary.md')).toBe(false)
  })

  test('a list stopped after the marking is not marked again', async () => {
    seed(OLD_SPACE)
    markOldListsSoon(ROOT, true, workspace)
    await settled()
    unmakeList(`${ROOT}/Projects/Garden.md`)

    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(false)
  })

  test('runs once per space: a device that hears the space was marked elsewhere marks nothing', async () => {
    seed(OLD_SPACE)
    workspace.itemMeta.setMany(ROOT, {
      Projects: { 'todo-lists': 'marked' },
      'Projects/Work/Work.md': { 'todo-list': 'yes' },
      'Projects/Work/Hiring.md': { 'todo-list': 'yes' },
    })
    const store = await rowsStore()
    expect(tasks(store.of())).toEqual(OLD_TASKS)

    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(workspace.itemMeta.of(`${ROOT}/Projects/Garden.md`)).toBeNull()
    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(false)
    expect(tasks(store.of())).toEqual(
      OLD_TASKS.filter((one) => !one.startsWith('Projects/Garden.md')),
    )
  })

  test('waits until a synced space has heard the account before marking', async () => {
    seed(OLD_SPACE)
    markOldListsSoon(ROOT, false, workspace)
    await settled()

    expect(workspace.itemMeta.listsMarked(ROOT)).toBe(false)
    expect(workspace.itemMeta.of(`${ROOT}/Projects/Garden.md`)).toBeNull()
    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(true)
    expect(listedAt(ROOT, 'Diary.md')).toBe(false)
  })

  test('a space with no Projects folder is marked as done with nothing to mark', async () => {
    held.disk.set(`${ROOT}/Diary.md`, '- [ ] Only a checkbox\n')
    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(workspace.itemMeta.listsMarked(ROOT)).toBe(true)
    expect(workspace.itemMeta.itemsOf(ROOT)).toEqual({})
  })

  test('the note chosen as the inbox is marked a list, so the account reads it as one too', async () => {
    seed({ 'Inbox.md': '- [ ] Call the bank\n' })
    stored.set('nib:inbox', JSON.stringify({ [ROOT]: 'Inbox.md' }))

    markOldListsSoon(ROOT, false, workspace)
    await settled()
    expect(workspace.itemMeta.of(`${ROOT}/Inbox.md`)).toBeNull()

    markOldListsSoon(ROOT, true, workspace)
    await settled()
    expect(workspace.itemMeta.of(`${ROOT}/Inbox.md`)).toEqual({ 'todo-list': 'yes' })
  })

  test('a Projects note stopped before the marking stays stopped, and is not marked', async () => {
    seed(OLD_SPACE)
    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(true)
    unmakeList(`${ROOT}/Projects/Garden.md`)
    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(false)

    markOldListsSoon(ROOT, true, workspace)
    await settled()

    expect(listedAt(ROOT, 'Projects/Garden.md')).toBe(false)
    expect(listedAt(ROOT, 'Projects/Work/Work.md')).toBe(true)
  })
})
