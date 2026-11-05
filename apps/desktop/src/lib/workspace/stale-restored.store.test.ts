import { describe, expect, test, vi } from 'vitest'

/** A stale tab over a newer file has two ways back: an open tab a launch restores and a
 *  closed one reopened, and a restored session holds both. They are one rule (`cameBack`,
 *  the closed stack's `wroteAll`), with the real store and across on a disk in memory. */

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const refused = vi.hoisted(() => ({ write: false }))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'write_note') {
      if (refused.write) return Promise.reject(new Error('no room'))
      writes.push(String(args?.content))
    }
    if (command === 'snapshot_note') versions.push(String(args?.content))
    return disk.current!.invoke(command, args)
  },
}))
const writes: string[] = []
const versions: string[] = []

const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { startAcross } = await import('./across')
await startAcross()

const ROOT = '/spaces/One'
const PATH = `${ROOT}/a.md`
const BASE = 'first\n\nsecond\n'
const WORDS = 'first\nTYPED\n\nsecond\n'

const draft = {
  kind: 'note' as const,
  path: PATH,
  name: 'a.md',
  doc: WORDS,
  base: BASE,
  dirty: true,
  cursor: 0,
  scroll: 0,
  share: 'k1',
}

async function fresh(file: string | null) {
  await workspace.writesSettled()
  refused.write = false
  d.reset()
  d.folders.add(ROOT)
  if (file !== null) d.files.set(PATH, file)
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.spaces = [{ id: 'one', name: 'One', root: ROOT }]
  workspace.activeSpaceId = 'one'
  await workspace.loadTree()
  writes.length = 0
  versions.length = 0
}

const ways = {
  async 'an open tab a launch restores'() {
    await workspace.applyLayout(
      {
        panel: null,
        focused: 'p1',
        frame: { kind: 'pane', pane: { id: 'p1', active: 0, linked: false, tabs: [draft] } },
      } as never,
      false,
    )
  },
  async 'a closed tab reopened'() {
    workspace.closed.restore([{ paneId: workspace.panes.focusedId, at: 0, draft }])
    await workspace.reopenClosed()
  },
}

describe.each(Object.entries(ways))('%s', (_, back) => {
  const after = async () => {
    await vi.waitFor(() => expect(workspace.tabs.at(-1)).toBeDefined())
    await workspace.writesSettled()
    return workspace.tabs.at(-1)!
  }

  test('the file went on: both words, once each, on the disk', async () => {
    const newer = 'first\n\nsecond\nNEWER\n'
    await fresh(newer)
    await back()
    const tab = await after()
    await vi.waitFor(() => expect(tab.note.dirty).toBe(false), { timeout: 3_000 })
    const file = d.files.get(PATH) ?? ''
    expect(file.match(/TYPED/g)).toHaveLength(1)
    expect(file.match(/NEWER/g)).toHaveLength(1)
    expect(tab.note.latest).toBe(file)
  })

  test('the file went on with those words in it: the file, clean, nothing written', async () => {
    const landed = `${WORDS}NEWER\n`
    await fresh(landed)
    await back()
    const tab = await after()
    expect(tab.note.latest).toBe(landed)
    expect(tab.note.dirty).toBe(false)
    expect(writes).toEqual([])
  })

  test('the file at the version they were typed on: they go down, what is under them is kept', async () => {
    await fresh(BASE)
    await back()
    const tab = await after()
    await vi.waitFor(() => expect(d.files.get(PATH)).toBe(WORDS), { timeout: 3_000 })
    expect(tab.note.latest).toBe(WORDS)
    expect(versions).toContain(BASE)
  })

  test('the file gone: a draft, and the file stays gone', async () => {
    await fresh(null)
    await back()
    const tab = await after()
    expect(tab.path).toBeNull()
    expect(tab.note.latest).toBe(WORDS)
    expect(d.files.has(PATH)).toBe(false)
  })
})

describe('the closed stack and its base', () => {
  const close = async () => {
    await workspace.open(PATH)
    const tab = workspace.tabs.at(-1)
    if (!tab) throw new Error('no tab')
    const end = tab.note.live.text.length
    tab.note.live.edit([{ from: end, to: end, insert: 'TYPED\n' }], { userEvent: 'input' })
    workspace.close(tab.id)
    await workspace.writesSettled()
    return workspace.closed.stack.at(-1)?.draft
  }

  test('a write that landed leaves nothing to weigh: no words, no base, the file wins', async () => {
    await fresh(BASE)
    const entry = await close()
    expect(entry).toMatchObject({ dirty: false, doc: '' })
    expect(entry?.base).toBeUndefined()

    const newer = `${BASE}TYPED\nNEWER\n`
    d.files.set(PATH, newer)
    writes.length = 0
    await workspace.reopenClosed()
    await workspace.writesSettled()
    expect(workspace.tabs.at(-1)?.note.latest).toBe(newer)
    expect(writes).toEqual([])
  })

  test('a write that was refused keeps its base: reopened over a newer file, it merges', async () => {
    await fresh(BASE)
    refused.write = true
    const entry = await close()
    refused.write = false
    expect(entry).toMatchObject({ dirty: true, base: BASE })

    d.files.set(PATH, `NEWER\n${BASE}`)
    await workspace.reopenClosed()
    await vi.waitFor(() => expect(d.files.get(PATH)).toContain('TYPED'), { timeout: 3_000 })
    expect(d.files.get(PATH)).toContain('NEWER')
  })

  test('a delete of its file leaves a draft with no base to weigh against', async () => {
    await fresh(BASE)
    refused.write = true
    await close()
    refused.write = false
    workspace.closed.follow({ op: 'removed', path: PATH } as never)
    const entry = workspace.closed.stack.at(-1)?.draft
    expect(entry).toMatchObject({ path: null, dirty: true })
    expect(entry?.base).toBeUndefined()
  })
})
