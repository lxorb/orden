import { expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))
vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))

const { Disk, memoryStorage } = await import('../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace/src/api')
await import('./workspace-ports')
const { startAcross } = await import('./workspace/src/across')
await startAcross()
const { heardNews } = await import('./workspace/src/outside.svelte')
const { protection } = await import('./protect/src/api')

async function setUp() {
  d.reset()
  d.folders.add('/s')
  d.folders.add('/s/Old')
  d.files.set('/s/Diary.md', 'secret diary\n')
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  protection.set('/s', '/s/Diary.md', 'password')
}

test('a locked note moved outside and a new note put in its place keeps its lock where it went', async () => {
  await setUp()
  d.files.delete('/s/Diary.md')
  d.files.set('/s/Old/Diary.md', 'secret diary\n')
  d.files.set('/s/Diary.md', 'fresh page\n')
  await heardNews({
    root: '/s',
    scan: false,
    gone: false,
    changes: [
      {
        kind: 'renamed',
        from: '/s/Diary.md',
        path: '/s/Old/Diary.md',
        size: 1,
        mtime: 1,
        id: 'a',
        dir: false,
      },
      { kind: 'created', path: '/s/Diary.md', size: 1, mtime: 2, id: 'b', dir: false },
    ],
  })
  console.log('ways after move-and-recreate', JSON.stringify(protection.ways('/s')))
  expect(protection.agentsMay('/s/Old/Diary.md')).toBe(false)
})

test('two outside renames in a row, the second onto the first one’s old name, keep the lock on the moved note', async () => {
  await setUp()
  d.files.set('/s/Plans.md', 'plans\n')
  await workspace.loadTree()
  d.files.delete('/s/Diary.md')
  d.files.set('/s/Old/Diary.md', 'secret diary\n')
  d.files.delete('/s/Plans.md')
  d.files.set('/s/Diary.md', 'plans\n')
  await heardNews({
    root: '/s',
    scan: false,
    gone: false,
    changes: [
      {
        kind: 'renamed',
        from: '/s/Diary.md',
        path: '/s/Old/Diary.md',
        size: 1,
        mtime: 1,
        id: 'a',
        dir: false,
      },
      {
        kind: 'renamed',
        from: '/s/Plans.md',
        path: '/s/Diary.md',
        size: 1,
        mtime: 1,
        id: 'p',
        dir: false,
      },
    ],
  })
  console.log('ways after rename chain', JSON.stringify(protection.ways('/s')))
  expect(protection.agentsMay('/s/Old/Diary.md')).toBe(false)
})

test('a locked note moved outside into a dot folder keeps its lock', async () => {
  await setUp()
  d.folders.add('/s/.trash')
  d.files.delete('/s/Diary.md')
  d.files.set('/s/.trash/Diary.md', 'secret diary\n')
  await heardNews({
    root: '/s',
    scan: false,
    gone: false,
    changes: [
      {
        kind: 'renamed',
        from: '/s/Diary.md',
        path: '/s/.trash/Diary.md',
        size: 1,
        mtime: 1,
        id: 'a',
        dir: false,
      },
    ],
  })
  console.log('ways after move into dot folder', JSON.stringify(protection.ways('/s')))
  expect(protection.agentsMay('/s/.trash/Diary.md')).toBe(false)
})

test('a locked note another program renames over a second note locks the note it became', async () => {
  await setUp()
  d.files.set('/s/Todo.md', 'todo\n')
  await workspace.loadTree()
  d.files.delete('/s/Diary.md')
  d.files.set('/s/Todo.md', 'secret diary\n')
  await heardNews({
    root: '/s',
    scan: false,
    gone: false,
    changes: [
      { kind: 'removed', path: '/s/Diary.md', dir: false, id: 'a' },
      { kind: 'modified', path: '/s/Todo.md', size: 13, mtime: 2, id: 'a', dir: false },
    ],
  })
  expect(protection.agentsMay('/s/Todo.md')).toBe(false)
})

test('a locked note another program moves into another space keeps its lock there', async () => {
  await setUp()
  d.folders.add('/t')
  workspace.spaces = [
    { id: 'S', name: 's', root: '/s' },
    { id: 'T', name: 't', root: '/t' },
  ]
  d.files.delete('/s/Diary.md')
  d.files.set('/t/Diary.md', 'secret diary\n')
  await heardNews({
    root: '/t',
    scan: false,
    gone: false,
    changes: [
      {
        kind: 'renamed',
        from: '/s/Diary.md',
        path: '/t/Diary.md',
        size: 13,
        mtime: 2,
        id: 'a',
        dir: false,
      },
    ],
  })
  expect(protection.agentsMay('/t/Diary.md')).toBe(false)
})
