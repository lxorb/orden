import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../../test/disk').Disk | null }))
vi.mock('../../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))

const { Disk, memoryStorage } = await import('../../../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../../../workspace.svelte')
const docs = await import('./index')

async function fresh(files: Record<string, string>) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add('/s')
  for (const [path, words] of Object.entries(files)) d.files.set(path, words)
  workspace.tabs = []
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
}

describe('a draft an agent wrote in, given its place', () => {
  test('its edits go on under the file, and can be taken back', async () => {
    await fresh({})
    workspace.openBlank()
    const tab = workspace.tabs.at(-1)
    if (!tab) throw new Error('no tab')
    const agent = { id: 'orden-draft', name: 'X' }
    await docs.notes.writeNote(agent, { path: '', tab: tab.id }, '# hello\n\nAGENT WORDS\n')
    expect([...docs.tracksOf(agent.id).keys()]).toEqual([`unsaved:${tab.note.key}`])

    await workspace.save(tab, '/s', 'Kept.md')
    await workspace.writesSettled()
    expect([...docs.tracksOf(agent.id).keys()]).toEqual(['/s/Kept.md'])

    expect((await docs.undoAgentIn(agent, '/s/Kept.md')).undone).toBe(1)
    expect(tab.note.latest).not.toContain('AGENT WORDS')
  })
})

describe('a note deleted and another made at its name', () => {
  test('the new note has a track of its own, and the old has its own back', async () => {
    await fresh({ '/s/n.md': '# n\n\nold words\n' })
    const agent = { id: 'orden-remade', name: 'X' }
    await docs.notes.editNote(agent, { path: 'n.md' }, [{ at: { quote: 'old' }, replace: 'OLD' }])
    const oldId = docs.tracksOf(agent.id).get('/s/n.md')?.ids[0]
    if (!oldId) throw new Error('no edit')
    const before = d.files.get('/s/n.md')

    await workspace.remove('/s/n.md', false)
    expect(docs.tracksOf(agent.id).size).toBe(0)
    expect(docs.tracksAside(agent.id).map(([path]) => path)).toEqual(['/s/n.md'])

    d.files.set('/s/n.md', '# new\n\nfresh words\n')
    await workspace.fileCame('/s/n.md', 'file')
    await workspace.loadTree()
    expect(docs.tracksOf(agent.id).size).toBe(0)

    await docs.notes.editNote(agent, { path: 'n.md' }, [
      { at: { quote: 'fresh' }, replace: 'FRESH' },
    ])
    const track = docs.tracksOf(agent.id).get('/s/n.md')
    const newId = track?.ids[0]
    if (!newId) throw new Error('no edit')
    expect(track.ids).toEqual([newId])

    await docs.undoSomeIn(agent, '/s/n.md', new Set([newId]))
    expect(d.files.get('/s/n.md')).toBe('# new\n\nfresh words\n')
    await workspace.remove('/s/n.md', false)
    d.files.set('/s/n.md', before ?? '')
    await workspace.fileCame('/s/n.md', 'file')

    expect(docs.tracksOf(agent.id).get('/s/n.md')?.ids).toEqual([oldId])
    await docs.undoSomeIn(agent, '/s/n.md', new Set([oldId]))
    expect(d.files.get('/s/n.md')).toBe('# n\n\nold words\n')
  })
})
