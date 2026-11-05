import { beforeEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')

const ROOT = '/spaces/One'
const PATH = `${ROOT}/a.md`

const tab = (fields: object) => ({
  kind: 'note' as const,
  path: PATH,
  name: 'a.md',
  doc: 'base\ntyped\n',
  base: 'base\n',
  dirty: true,
  cursor: 0,
  scroll: 0,
  share: 'k1',
  ...fields,
})

const split = (one: object, other: object) => ({
  panel: null,
  focused: 'p1',
  frame: {
    kind: 'split' as const,
    id: 'x',
    along: 'row' as const,
    fraction: 0.5,
    sides: [
      { kind: 'pane' as const, pane: { id: 'p1', active: 0, linked: false, tabs: [one] } },
      { kind: 'pane' as const, pane: { id: 'p2', active: 0, linked: false, tabs: [other] } },
    ] as [never, never],
  },
})

const single = (one: object) => ({
  panel: null,
  focused: 'p1',
  frame: { kind: 'pane' as const, pane: { id: 'p1', active: 0, linked: false, tabs: [one] } },
})

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folders.add(ROOT)
  workspace.spaces = [{ id: 'one', name: 'One', root: ROOT }]
  workspace.activeSpaceId = 'one'
  workspace.tabs = []
  await workspace.loadTree()
})

test('one note in two panes whose file has gone comes back as one draft', async () => {
  await workspace.applyLayout(split(tab({}), tab({})), false)
  expect(workspace.tabs).toHaveLength(2)
  expect(workspace.tabs[0]?.note).toBe(workspace.tabs[1]?.note)
  expect(workspace.tabs[0]?.path).toBeNull()
})

test('a restored tab fetches across for its write, and takes in what the file said since', async () => {
  disk.current?.files.set(PATH, 'base\n')
  const { startAcross } = await import('./across')
  let fetched = 0
  workspace.acrossWhenWriting(() => {
    fetched += 1
    return startAcross()
  })
  await workspace.applyLayout(single(tab({})) as never, false)
  disk.current?.files.set(PATH, 'base\nnewer\n')
  await vi.waitFor(() => expect(disk.current?.files.get(PATH)).toContain('typed'), {
    timeout: 3_000,
  })
  expect(fetched).toBe(1)
  expect(disk.current?.files.get(PATH)).toContain('newer')
})

test('a key typed in a restored tab lands, with the words it came back with', async () => {
  disk.current?.files.set(PATH, 'base\n')
  await workspace.applyLayout(single(tab({})) as never, false)
  const note = workspace.tabs[0]?.note
  if (!note) throw new Error('no note')
  const end = note.live.text.length
  note.live.edit([{ from: end, to: end, insert: 'key\n' }], { userEvent: 'input' })
  await workspace.writesSettled()
  expect(disk.current?.files.get(PATH)).toBe('base\ntyped\nkey\n')
})

test('closing it lets it go', async () => {
  disk.current?.files.set(PATH, 'base\n')
  await workspace.loadTree()
  await workspace.applyLayout(single(tab({})) as never, false)
  const id = workspace.tabs[0]?.id
  if (!id) throw new Error('no tab')
  workspace.close(id)
  await workspace.writesSettled()
  expect(disk.current?.files.get(PATH)).toBe('base\ntyped\n')
})

test('words typed in a note this launch opened do not wait for anybody', async () => {
  disk.current?.files.set(PATH, 'base\n')
  await workspace.loadTree()
  await workspace.open(PATH)
  const note = workspace.tabs[0]?.note
  if (!note) throw new Error('no note')
  note.replace('base\nnew\n')
  await workspace.writesSettled()
  expect(disk.current?.files.get(PATH)).toBe('base\nnew\n')
})

test('a tab closed within the pause: once the write has landed the entry holds no words', async () => {
  disk.current?.files.set(PATH, 'base\n')
  await workspace.loadTree()
  await workspace.open(PATH)
  const tab = workspace.tabs[0]
  if (!tab) throw new Error('no tab')
  tab.note.replace('base\nCHANGED-MY-MIND\n')
  const { id } = tab
  workspace.close(id)
  await workspace.writesSettled()
  expect(disk.current?.files.get(PATH)).toBe('base\nCHANGED-MY-MIND\n')
  const session = JSON.parse(
    (workspace.persist(), localStorage.getItem('nib:workspace')) ?? 'null',
  ) as { closed?: { draft: { dirty: boolean; doc: string } }[] } | null
  if (session?.closed?.length) {
    expect(session.closed.at(-1)?.draft).toMatchObject({ dirty: false, doc: '' })
  }
})
