import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))
const asked = vi.hoisted(() => ({ tabs: [] as string[][], answer: true }))
vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))
vi.mock('./terminal/closing', () => ({
  mayEnd: (closing: readonly { kind: string; id: string }[]) => {
    asked.tabs.push(closing.filter((tab) => tab.kind === 'terminal').map((tab) => tab.id))
    return Promise.resolve(asked.answer)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { NoteDoc, Tab } = await import('./workspace/documents.svelte')

function terminal() {
  const note = new NoteDoc(
    { kind: 'terminal', path: null, name: 'Terminal', text: '', dirty: false },
    () => undefined,
  )
  const tab = new Tab(note, workspace.panes.focusedId)
  workspace.tabs = [...workspace.tabs, tab]
  return tab
}

beforeEach(async () => {
  await workspace.writesSettled()
  d.reset()
  d.folders.add('/s')
  d.files.set('/s/a.md', '# a\n')
  d.files.set('/s/b.md', '# b\n')
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  asked.tabs.length = 0
  asked.answer = true
  await workspace.open('/s/a.md')
  workspace.saveLayout('just a')
  workspace.tabs = []
})

describe('a layout over a terminal', () => {
  test('refused, everything stays', async () => {
    const shell = terminal()
    asked.answer = false
    await workspace.useLayout('just a')
    expect(asked.tabs).toEqual([[shell.id]])
    expect(workspace.tabs).toEqual([shell])
    expect(workspace.closed.stack).toEqual([])
  })

  test('agreed, it goes, and can be reopened with the rest', async () => {
    terminal()
    await workspace.open('/s/b.md')
    await workspace.useLayout('just a')
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/s/a.md'])
    expect(workspace.closed.stack.map((one) => one.draft.kind).sort()).toEqual(['note', 'terminal'])
    expect(workspace.closed.stack.at(-1)?.batch).toBeDefined()
  })

  test('with no terminal nothing is asked', async () => {
    await workspace.open('/s/b.md')
    await workspace.useLayout('just a')
    expect(asked.tabs).toEqual([])
    expect(workspace.tabs.map((tab) => tab.path)).toEqual(['/s/a.md'])
  })

  test('a note the layout holds as well is no tab going', async () => {
    await workspace.open('/s/a.md')
    await workspace.useLayout('just a')
    expect(workspace.closed.stack).toEqual([])
  })
})
