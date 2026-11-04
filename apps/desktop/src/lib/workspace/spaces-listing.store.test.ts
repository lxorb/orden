import { beforeEach, expect, test, vi } from 'vitest'

/** The list of spaces read again while it is being changed, or read when it will not answer:
 *  a listing that failed says nothing about the spaces, and one read before a space was made
 *  says nothing about that space. */

const held = vi.hoisted(() => ({
  disk: null as import('../../../test/disk').Disk | null,
  listing: [] as { name: string; path: string }[],
  refuse: false,
  gate: null as Promise<void> | null,
  /** What the answer of `create_space` waits for, the folder being there already. */
  making: null as Promise<void> | null,
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') {
      if (held.refuse) throw new Error('the folder would not list')
      const listed = [...held.listing]
      if (held.gate) await held.gate
      return listed
    }
    if (command === 'create_space') {
      const made = { name: String(args?.name), path: `/spaces/${String(args?.name)}` }
      held.disk!.folders.add(made.path)
      held.listing.push(made)
      if (held.making) await held.making
      return made
    }
    return held.disk!.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')

const ONE = { name: 'One', path: '/spaces/One' }

beforeEach(async () => {
  held.refuse = false
  held.gate = null
  held.making = null
  held.disk!.reset()
  held.disk!.folders.add(ONE.path)
  held.listing = [ONE]
  workspace.tabs = []
  workspace.spaces = [{ id: 'one', name: 'One', root: ONE.path }]
  workspace.activeSpaceId = 'one'
  await workspace.loadTree()
})

test('a listing that failed keeps the spaces there are, and the one that is open', async () => {
  held.refuse = true
  await workspace.loadSpaces()

  expect(workspace.spaces.map((one) => one.name)).toEqual(['One'])
  expect(workspace.activeSpaceId).toBe('one')
})

test('a listing read before a space was made here leaves it, and it stays the open one', async () => {
  let go: () => void = () => undefined
  held.gate = new Promise((open) => (go = open))
  const listing = workspace.loadSpaces()
  await new Promise((later) => setTimeout(later))
  held.gate = null

  const made = await workspace.addSpace('Second')
  go()
  await listing

  expect(workspace.spaces.map((one) => one.name)).toEqual(['One', 'Second'])
  expect(workspace.activeSpaceId).toBe(made?.id)
})

test('a listing that sees a space being made first is the one space, with one id', async () => {
  let go: () => void = () => undefined
  held.making = new Promise((open) => (go = open))
  const making = workspace.addSpace('Third')
  await vi.waitFor(() => expect(held.listing).toHaveLength(2))
  await workspace.loadSpaces()
  go()
  const made = await making

  expect(workspace.spaces.filter((one) => one.name === 'Third')).toHaveLength(1)
  expect(workspace.activeSpaceId).toBe(made?.id)
})
