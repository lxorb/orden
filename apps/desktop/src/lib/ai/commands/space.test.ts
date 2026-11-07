import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writable: true,
  opened: [] as string[],
}))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 's', name: 'Plans', root: '/space' }],
    activeSpace: { root: '/space' },
    noteText: (path: string) => Promise.resolve(disk.files.get(path) ?? null),
    open: (path: string) => {
      disk.opened.push(path)
      return Promise.resolve()
    },
    loadTree: () => Promise.resolve(),
    fileCame: () => Promise.resolve(),
  },
}))
vi.mock('../../workspace/write-file', () => ({
  writeIfAbsent: (path: string, text: string) => {
    if (disk.files.has(path)) return Promise.resolve(false)
    disk.files.set(path, text)
    return Promise.resolve(true)
  },
}))
vi.mock('../../on-disk', () => ({
  onDisk: (path: string) => Promise.resolve(disk.files.has(path)),
}))
vi.mock('../../sharing.svelte', () => ({ canWriteAt: () => disk.writable }))
vi.mock('../../sync.svelte', () => ({ sync: { nudge: vi.fn() } }))
vi.mock('./found', () => ({
  found: () => Promise.resolve([]),
  foundNamed: () => Promise.resolve(null),
  fromOthers: () => Promise.resolve(false),
  rootOfSpace: () => null,
}))
vi.mock('./host', () => ({ sendHere: vi.fn() }))
vi.mock('./instructions', () => ({ setRemembers: vi.fn(), STYLES: [] }))
vi.mock('./notes', () => ({ commandName: (one: string) => one }))

const { memory } = await import('./space')
const host = { line: vi.fn() } as unknown as Parameters<typeof memory>[0]
const PATH = '/space/AGENTS.md'

beforeEach(() => {
  disk.files.clear()
  disk.writable = true
  disk.opened = []
})

describe('/memory', () => {
  test('with no file makes it, with the heading, and opens it', async () => {
    await memory(host, null, '')
    expect(disk.files.get(PATH)).toBe('# AGENTS\n\n## Memory\n')
    expect(disk.opened).toEqual([PATH])
  })

  test('with a file leaves its words as they are, and opens it', async () => {
    disk.files.set(PATH, '# Mine\n')
    await memory(host, null, '')
    expect(disk.files.get(PATH)).toBe('# Mine\n')
    expect(disk.opened).toEqual([PATH])
  })

  test('in a space shared to be read makes nothing, and shows what there is', async () => {
    disk.writable = false
    await memory(host, null, '')
    expect(disk.files.has(PATH)).toBe(false)
    expect(disk.opened).toEqual([PATH])
  })
})
