import { flushSync } from 'svelte'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'scan_links') return scanned(String(args?.root))
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { scanNote } = await import('@orden/scan/note')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { links } = await import('../../src/lib/link-index.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
await import('../../src/lib/rows/rows.svelte')
await import('../../src/lib/views/runner.svelte')
const { makeList, unmakeList } = await import('../../src/lib/rows/todo-lists')
const { computed, root, watch } = await import('./runes.svelte')
type NoteIndex = import('@orden/editor').NoteIndex

function scanned(space: string) {
  const inside = [...(disk.current?.files ?? [])].filter(([path]) => path.startsWith(`${space}/`))
  return {
    notes: inside
      .filter(([path]) => path.endsWith('.md'))
      .map(([path, text]) => scanNote(path.slice(space.length + 1), text)),
    files: [],
  }
}

const WORK = '/spaces/Work'
const PLAN = `${WORK}/Plan.md`
const OTHER = `${WORK}/Other.md`

let stop: (() => void) | undefined

beforeAll(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(PLAN, '- [ ] Call mum tomorrow\n')
  one.files.set(OTHER, '- [ ] Read\n')
  workspace.spaces = [{ id: 'work', name: 'Work', root: WORK }]
  workspace.activeSpaceId = 'work'
  workspace.itemMeta.markListsMarked(WORK)
  await workspace.loadTree()
  void startup.shown()
  await links.build(WORK)
  flushSync()
})

afterEach(() => stop?.())

function watched(path: string) {
  const handed: NoteIndex[] = []
  stop = root(() => {
    const index = computed(() => links.index(path))
    watch(() => {
      handed.push(index())
    })
  })
  flushSync()
  return () => handed.map((one) => one.tasks !== undefined)
}

test('a note an open editor shows is handed the todo tools the moment it is made a list, and loses them when it stops', () => {
  const handed = watched(PLAN)
  expect(handed()).toEqual([false])

  makeList(PLAN)
  flushSync()
  expect(handed()).toEqual([false, true])

  unmakeList(PLAN)
  flushSync()
  expect(handed()).toEqual([false, true, false])
})

test('the same when the mark arrives from another device', async () => {
  let heard: Record<string, Record<string, string>> = {}
  const unhook = workspace.itemMeta.describeBy({
    describedIn: () => heard,
    describe: () => Promise.resolve([]),
  })
  const handed = watched(PLAN)
  try {
    heard = { 'Plan.md': { 'todo-list': 'yes' } }
    await workspace.itemMeta.fromEngine(WORK)
    flushSync()
    expect(handed()).toEqual([false, true])

    heard = { 'Plan.md': { 'todo-list': 'no' } }
    await workspace.itemMeta.fromEngine(WORK)
    flushSync()
    expect(handed()).toEqual([false, true, false])
  } finally {
    unhook()
  }
})

test('and metadata of another note does not hand the editor its note again', () => {
  const handed = watched(PLAN)
  makeList(OTHER)
  workspace.itemMeta.set(OTHER, { 'done-on': '{}' })
  flushSync()
  expect(handed()).toEqual([false])
})
