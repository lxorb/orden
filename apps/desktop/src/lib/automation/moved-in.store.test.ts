import { beforeEach, describe, expect, test, vi } from 'vitest'

/** An agent's move through the real store, on a map of a disk: the two steps a move and a
 *  rename are must not stop anywhere the file may not be, or touch what is already there. */

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
const hard = new Disk()
disk.current = hard
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
const { movedIn } = await import('./acts')

const ROOT = '/space'

beforeEach(async () => {
  hard.reset()
  hard.folders.add(`${ROOT}/a`)
  hard.folders.add(`${ROOT}/b`)
  hard.files.set(`${ROOT}/AGENTS.md`, 'the instructions')
  hard.files.set(`${ROOT}/a/AGENTS.md`, 'a note')
  hard.files.set(`${ROOT}/a/x.md`, 'the x in a')

  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.undone.stack = []
  await workspace.loadTree()
})

describe('a nested AGENTS.md moved to the top under another name', () => {
  test('moves, and the space keeps its instructions', async () => {
    await expect(movedIn(ROOT, 'a/AGENTS.md', 'X.md')).resolves.toBe('X.md')

    expect(hard.files.get(`${ROOT}/AGENTS.md`)).toBe('the instructions')
    expect(hard.files.get(`${ROOT}/X.md`)).toBe('a note')
    expect(hard.files.has(`${ROOT}/a/AGENTS.md`)).toBe(false)
  })

  test('with no instructions at the top, does not become them on the way', async () => {
    hard.files.delete(`${ROOT}/AGENTS.md`)
    await workspace.loadTree()
    await movedIn(ROOT, 'a/AGENTS.md', 'X.md')

    expect(hard.files.has(`${ROOT}/AGENTS.md`)).toBe(false)
    expect(hard.files.get(`${ROOT}/X.md`)).toBe('a note')
  })

  test('refused where the name in its own folder is taken, and nothing moves', async () => {
    hard.files.set(`${ROOT}/a/X.md`, 'in the way')
    await workspace.loadTree()

    await expect(movedIn(ROOT, 'a/AGENTS.md', 'X.md')).rejects.toThrow()
    expect(hard.files.get(`${ROOT}/AGENTS.md`)).toBe('the instructions')
    expect(hard.files.get(`${ROOT}/a/AGENTS.md`)).toBe('a note')
    expect(hard.files.get(`${ROOT}/a/X.md`)).toBe('in the way')
  })
})

describe('a move under a new name', () => {
  test('refused where it lands is taken, and nothing is renamed on the way', async () => {
    hard.files.set(`${ROOT}/b/x.md`, 'the x in b')
    hard.files.set(`${ROOT}/b/y.md`, 'the y in b')
    await workspace.loadTree()

    await expect(movedIn(ROOT, 'a/x.md', 'b/y.md')).rejects.toThrow('already there')
    expect(hard.files.get(`${ROOT}/a/x.md`)).toBe('the x in a')
    expect(hard.files.get(`${ROOT}/b/y.md`)).toBe('the y in b')
  })

  test('goes through a stop that is free', async () => {
    await movedIn(ROOT, 'a/x.md', 'b/y.md')

    expect(hard.files.get(`${ROOT}/b/y.md`)).toBe('the x in a')
    expect(hard.files.has(`${ROOT}/a/x.md`)).toBe(false)
  })

  test('is not stopped by a file under the old name where it lands', async () => {
    hard.files.set(`${ROOT}/b/x.md`, 'the x in b')
    await workspace.loadTree()

    await expect(movedIn(ROOT, 'a/x.md', 'b/y.md')).resolves.toBe('b/y.md')

    expect(hard.files.get(`${ROOT}/b/y.md`)).toBe('the x in a')
    expect(hard.files.get(`${ROOT}/b/x.md`)).toBe('the x in b')
    expect(hard.files.has(`${ROOT}/a/x.md`)).toBe(false)
  })
})

describe('a tile of a nested AGENTS.md let go of over the top of the space', () => {
  const tile = () =>
    workspace.bookmarks.put(ROOT, [{ kind: 'note', path: 'a/AGENTS.md', text: '' }])

  test('keeps its tile, and does not take the place of the instructions', async () => {
    tile()
    const { unkeepInto } = await import('../essentials.svelte')
    await unkeepInto(0, ROOT)

    expect(workspace.bookmarks.of(ROOT)).toHaveLength(1)
    expect(hard.files.get(`${ROOT}/AGENTS.md`)).toBe('the instructions')
    expect(hard.files.get(`${ROOT}/a/AGENTS.md`)).toBe('a note')
  })

  test('with none at the top, does not become them', async () => {
    hard.files.delete(`${ROOT}/AGENTS.md`)
    await workspace.loadTree()
    tile()
    const { unkeepInto } = await import('../essentials.svelte')
    await unkeepInto(0, ROOT)

    expect(workspace.bookmarks.of(ROOT)).toHaveLength(1)
    expect(hard.files.has(`${ROOT}/AGENTS.md`)).toBe(false)
  })

  test('into a folder it moves as ever', async () => {
    tile()
    const { unkeepInto } = await import('../essentials.svelte')
    await unkeepInto(0, `${ROOT}/b`)

    expect(workspace.bookmarks.of(ROOT)).toHaveLength(0)
    expect(hard.files.get(`${ROOT}/b/AGENTS.md`)).toBe('a note')
  })
})
