import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Words that came back with no write of them, meeting the file's document already open: a
 *  note clicked in the launch before the restore reached it, a closed tab reopened over the
 *  same note opened again. The words are not dropped for the clean document, or written over
 *  what it holds. */

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const versions = vi.hoisted(() => [] as string[])
const slow = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'snapshot_note') versions.push(String(args?.content))
    if (command === 'read_note' && slow.hold) await slow.hold
    return disk.current!.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { startAcross } = await import('./across')
await startAcross()

const ROOT = '/spaces/One'
const PATH = `${ROOT}/a.md`
const tab = (fields: object = {}) => ({
  kind: 'note' as const,
  path: PATH,
  name: 'a.md',
  doc: 'base\ntyped\n',
  base: 'base\n',
  dirty: true,
  cursor: 0,
  scroll: 0,
  share: 'old-run',
  ...fields,
})
const layout = (...tabs: object[]) =>
  ({
    panel: null,
    focused: 'p1',
    frame: { kind: 'pane', pane: { id: 'p1', active: 0, linked: false, tabs } },
  }) as never

beforeEach(async () => {
  await workspace.writesSettled()
  slow.hold = null
  d.reset()
  d.folders.add(ROOT)
  d.files.set(PATH, 'base\n')
  versions.length = 0
  workspace.spaces = [{ id: 'one', name: 'One', root: ROOT }]
  workspace.activeSpaceId = 'one'
  workspace.tabs = []
  workspace.closed.stack = []
  await workspace.loadTree()
})

describe('unwritten words meeting an open document', () => {
  test('a note open already takes them, and the file has them, with a version of before', async () => {
    await workspace.open(PATH)
    await workspace.applyLayout(layout(tab()), false)
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\ntyped\n')
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.tabs[0]?.note.latest).toBe('base\ntyped\n')
    expect(versions).toContain('base\n')
  })

  test('a note on its way open, its read not answered yet, takes them as well', async () => {
    let go: () => void = () => undefined
    slow.hold = new Promise((open) => (go = open))
    const opening = workspace.open(PATH)
    const arriving = workspace.applyLayout(layout(tab()), false)
    await new Promise((later) => setTimeout(later))
    go()
    await Promise.all([opening, arriving])
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\ntyped\n')
  })

  test('a closed entry reopened over the same note opened again, and it is spent', async () => {
    await workspace.loadTree()
    workspace.closed.restore([{ paneId: workspace.panes.focusedId, at: 0, draft: tab() }])
    await workspace.open(PATH)
    await workspace.reopenClosed()
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\ntyped\n')
    expect(workspace.closed.stack).toHaveLength(0)
  })

  test('a closed entry of another space goes back there, and meets the note open in it', async () => {
    const OTHER = '/spaces/Two'
    const THERE = `${OTHER}/a.md`
    d.folders.add(OTHER)
    d.files.set(THERE, 'base\n')
    workspace.spaces = [...workspace.spaces, { id: 'two', name: 'Two', root: OTHER }]
    await workspace.showSpace('two')
    await workspace.open(THERE)
    const open = workspace.tabs.find((one) => one.path === THERE)!.note
    await workspace.showSpace('one')
    workspace.closed.restore([
      { paneId: workspace.panes.focusedId, at: 0, draft: tab({ path: THERE, space: 'two' }) },
    ])

    await workspace.reopenClosed()
    await workspace.writesSettled()

    expect(workspace.activeSpaceId).toBe('two')
    expect(workspace.active?.note).toBe(open)
    expect(open.latest).toBe('base\ntyped\n')
    expect(d.files.get(THERE)).toBe('base\ntyped\n')
    expect(workspace.closed.stack).toHaveLength(0)
    await workspace.showSpace('one')
  })

  test('what the open document has typed itself stays beside them', async () => {
    await workspace.open(PATH)
    workspace.tabs[0]!.note.replace('intro\nbase\n')
    await workspace.applyLayout(layout(tab()), false)
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('intro\nbase\ntyped\n')
  })

  test('words already in the open document are not written twice', async () => {
    d.files.set(PATH, 'base\ntyped\nmore\n')
    await workspace.open(PATH)
    await workspace.applyLayout(layout(tab()), false)
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\ntyped\nmore\n')
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.tabs[0]?.dirty).toBe(false)
  })

  test('with nothing to merge against they stay as a draft beside it', async () => {
    await workspace.open(PATH)
    const bare = tab()
    delete (bare as { base?: string }).base
    await workspace.applyLayout(layout(bare), false)
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\n')
    const words = workspace.tabs.map((one) => [one.path, one.note.latest])
    expect(words).toContainEqual([PATH, 'base\n'])
    expect(words).toContainEqual([null, 'base\ntyped\n'])
  })

  test('a plane does not merge: its words stay as a draft beside the open one', async () => {
    const plane = `${ROOT}/p.canvas`
    d.files.set(plane, '{"nodes":[],"edges":[]}')
    await workspace.loadTree()
    await workspace.open(plane)
    const words = '{"nodes":[{"id":"x"}],"edges":[]}'
    await workspace.applyLayout(
      layout(tab({ kind: 'canvas', path: plane, name: 'p.canvas', doc: words, base: '{}' })),
      false,
    )
    await workspace.writesSettled()

    expect(d.files.get(plane)).toBe('{"nodes":[],"edges":[]}')
    expect(workspace.tabs.map((one) => one.note.latest)).toContain(words)
  })

  test('two panes of one note that came back are one document, its words once', async () => {
    d.files.set(PATH, 'base\nelsewhere\n')
    await workspace.applyLayout(layout(tab(), tab()), false)
    await workspace.writesSettled()

    const notes = new Set(workspace.tabs.map((one) => one.note))
    expect(notes.size).toBe(1)
    const file = d.files.get(PATH)!
    expect(file.match(/typed/g)).toHaveLength(1)
    expect(file).toContain('elsewhere')
  })

  test('a note clicked and typed in a launch, then a kill: two tabs of it fold into one', async () => {
    const other = `${ROOT}/z.md`
    d.files.set(other, 'z\n')
    await workspace.loadTree()
    await workspace.applyLayout(
      layout(
        tab({ path: other, name: 'z.md', doc: '', dirty: false, base: undefined, share: 'z' }),
        tab({ share: 'read' }),
        tab({ share: 'typed in the gap', doc: 'base\nmore\n' }),
      ),
      false,
    )
    await workspace.writesSettled()

    expect(workspace.tabs.map((one) => one.path)).toEqual([other, PATH])
    const file = d.files.get(PATH)!
    expect(file).toContain('typed')
    expect(file).toContain('more')
  })

  test('the tab folded away was in front: the one it folded into is', async () => {
    const shown = layout(tab({ share: 'read' }), tab({ share: 'gap', doc: 'base\nmore\n' })) as {
      frame: { pane: { active: number } }
    }
    shown.frame.pane.active = 1
    await workspace.applyLayout(shown as never, false)
    await workspace.writesSettled()

    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.active?.path).toBe(PATH)
  })

  test('two panes of one note are still two tabs of it', async () => {
    const twoPanes = {
      panel: null,
      focused: 'p1',
      frame: {
        kind: 'split',
        id: 's',
        along: 'row',
        fraction: 0.5,
        sides: [
          {
            kind: 'pane',
            pane: { id: 'p1', active: 0, linked: false, tabs: [tab({ share: 'a' })] },
          },
          {
            kind: 'pane',
            pane: { id: 'p2', active: 0, linked: false, tabs: [tab({ share: 'b' })] },
          },
        ],
      },
    }
    await workspace.applyLayout(twoPanes as never, false)
    await workspace.writesSettled()

    expect(workspace.tabs).toHaveLength(2)
    expect(new Set(workspace.tabs.map((one) => one.note)).size).toBe(1)
  })

  test('a closed entry of the document still open is a view of it, not words to bring back', async () => {
    await workspace.open(PATH)
    const note = workspace.tabs[0]!.note
    workspace.closed.restore([
      { paneId: workspace.panes.focusedId, at: 0, draft: tab({ share: note.key }) },
    ])
    await workspace.reopenClosed()
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\n')
  })

  test('a landed write of the same words spends an entry of the run before', async () => {
    workspace.closed.restore([{ paneId: workspace.panes.focusedId, at: 0, draft: tab() }])
    await workspace.applyLayout(layout(tab()), false)
    await workspace.writesSettled()

    expect(d.files.get(PATH)).toBe('base\ntyped\n')
    expect(workspace.closed.stack[0]?.draft.dirty).toBe(false)
  })
})
