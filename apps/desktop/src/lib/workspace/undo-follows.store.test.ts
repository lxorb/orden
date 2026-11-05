import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { failed } = await import('../views/failed.svelte')

async function fresh(files: Record<string, string>) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add('/s')
  for (const [path, words] of Object.entries(files)) d.files.set(path, words)
  workspace.tabs = []
  workspace.undone.stack = []
  workspace.undone.ahead = []
  failed.dismiss()
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
}

async function spaceRenamed(to: string) {
  const space = workspace.spaces[0]
  if (!space) throw new Error('no space')
  const from = space.root
  await d.invoke('rename_note', { from, to })
  space.root = to
  await workspace.fileMoved(from, to, 'space')
  await workspace.loadTree()
}

describe('undo after the space was renamed', () => {
  test('a delete comes back in the space, not in a new folder of the old name', async () => {
    await fresh({ '/s/x.md': 'words\n' })
    await workspace.remove('/s/x.md', false)
    await spaceRenamed('/t')
    await workspace.undoFileAction()
    expect(d.files.get('/t/x.md')).toBe('words\n')
    expect([...d.files.keys()]).toEqual(['/t/x.md'])
  })

  test('renamed away and back, a delete comes back at its own name', async () => {
    await fresh({ '/s/x.md': 'words\n' })
    await workspace.remove('/s/x.md', false)
    await spaceRenamed('/t')
    await spaceRenamed('/s')
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/s/x.md'])
  })

  test('a rename goes back, and nothing is left on top', async () => {
    await fresh({ '/s/x.md': 'words\n' })
    await workspace.rename('/s/x.md', 'y.md')
    await spaceRenamed('/t')
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/t/x.md'])
    expect(workspace.undone.last).toBeUndefined()
    expect(failed.retry).toBe(null)
  })

  test('a step of a file moved in another window follows it', async () => {
    await fresh({ '/s/x.md': 'words\n' })
    await workspace.rename('/s/x.md', 'y.md')
    await d.invoke('rename_note', { from: '/s/y.md', to: '/s/z.md' })
    await workspace.fileOps.tell({
      op: 'moved',
      from: '/s/y.md',
      to: '/s/z.md',
      kind: 'file',
      root: '/s',
      heard: true,
    })
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/s/x.md'])
  })

  test('a move of its own leaves the steps under it as they were', async () => {
    await fresh({ '/s/x.md': 'words\n' })
    await workspace.rename('/s/x.md', 'y.md')
    await workspace.rename('/s/y.md', 'z.md')
    await workspace.undoFileAction()
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/s/x.md'])
  })
})

describe('an undo that will not go', () => {
  test('says so, and can be let go of', async () => {
    await fresh({ '/s/x.md': 'words\n', '/s/older.md': 'older\n' })
    await workspace.rename('/s/older.md', 'old.md')
    await workspace.rename('/s/x.md', 'y.md')
    d.files.delete('/s/y.md')
    await workspace.undoFileAction()
    expect(failed.retry).not.toBe(null)
    expect(failed.undoing).toBe(true)
    expect(workspace.undone.stack.length).toBe(2)

    failed.giveUp()
    expect(failed.retry).toBe(null)
    expect(workspace.undone.stack.length).toBe(1)
    await workspace.undoFileAction()
    expect(d.files.has('/s/older.md')).toBe(true)
  })

  test('an empty note the account held comes back empty', async () => {
    await fresh({})
    workspace.undone.record({ kind: 'delete', path: '/s/e.md', content: '' })
    await workspace.undoFileAction()
    expect(d.files.get('/s/e.md')).toBe('')
    expect(workspace.undone.last).toBeUndefined()
  })
})

describe('a move onto a name taken', () => {
  test('is said, and the rest of the selection goes', async () => {
    await fresh({ '/s/a/x.md': 'x from a', '/s/a/y.md': 'y', '/s/b/x.md': 'x from b' })
    const moved = await workspace.moveMany(['/s/a/x.md', '/s/a/y.md'], '/s/b')
    expect(moved).toBe(false)
    expect(failed.retry).not.toBe(null)
    expect(d.files.get('/s/b/x.md')).toBe('x from b')
    expect(d.files.get('/s/a/x.md')).toBe('x from a')
    expect(d.files.get('/s/b/y.md')).toBe('y')
  })
})

describe('a delete that leaves a nested note alone in its folder', () => {
  test('with the name above taken it stays nested, and the delete says it was done', async () => {
    await fresh({ '/s/A.md': 'outer\n', '/s/A/A.md': 'inner\n', '/s/A/B.md': 'b\n' })
    await workspace.remove('/s/A/B.md', false)
    expect(d.files.has('/s/A/B.md')).toBe(false)
    expect(d.files.get('/s/A.md')).toBe('outer\n')
    expect(d.files.get('/s/A/A.md')).toBe('inner\n')
  })
})
