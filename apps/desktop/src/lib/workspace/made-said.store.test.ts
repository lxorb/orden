import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: false,
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
const { onDisk } = await import('../platform/src/on-disk')
const { hearWrites, writeBytes, writeFile } = await import('./write-file')

const ROOT = '/space'
const made: string[] = []
const wrote: string[] = []
let stop: () => void = () => undefined

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(`${ROOT}/Plan.md`, '# Plan\n')
  one.folders.add(`${ROOT}/Work`)
  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.undone.stack = []
  await workspace.loadTree()
  made.length = 0
  wrote.length = 0
  stop = hearWrites({
    there: (path) => onDisk(path),
    made: (path) => {
      made.push(path)
      return Promise.resolve()
    },
    wrote: (path, content) => void wrote.push(`${path}: ${content}`),
  })
})

afterEach(() => stop())

describe('where no folder watcher hears what the app writes', () => {
  test('a new note says it was made, once', async () => {
    await workspace.createNote(`${ROOT}/Work`, 'Fresh.md')
    await workspace.noteFrom('# From words\n\nhello\n')
    await workspace.createCanvas(ROOT, 'Board.canvas')
    expect(made).toEqual([`${ROOT}/Work/Fresh.md`, `${ROOT}/From words.md`, `${ROOT}/Board.canvas`])
    expect(wrote).toEqual([])
  })

  test('a file written new by any other part of the app says it was made', async () => {
    await writeFile(`${ROOT}/Work/Split.md`, '# Split\n')
    await writeBytes(`${ROOT}/Work/picture.png`, new Uint8Array([0, 0, 0]))
    expect(made).toEqual([`${ROOT}/Work/Split.md`, `${ROOT}/Work/picture.png`])
  })

  test('writing over a file that is there says what it holds now, and nothing was made', async () => {
    await writeFile(`${ROOT}/Plan.md`, '# Plan\n\nmore\n')
    expect(made).toEqual([])
    expect(wrote).toEqual([`${ROOT}/Plan.md: # Plan\n\nmore\n`])
  })

  test('once the engine stops hearing, a write says nothing', async () => {
    stop()
    await writeFile(`${ROOT}/Work/Later.md`, '# Later\n')
    expect(made).toEqual([])
  })
})
