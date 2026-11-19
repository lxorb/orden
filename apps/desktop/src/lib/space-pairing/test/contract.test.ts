import type { SyncPairing } from '@orden/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Space {
  id: string
  name: string
  root: string
}
const world = vi.hoisted(() => ({
  local: [] as Space[],
  remote: [] as { id: string; name: string; role: string; icon?: string }[],
  made: [] as string[],
  remembered: 0,
  order: [] as string[],
}))
vi.mock('../../accounts/src/api', () => ({
  account: {
    user: { id: 'u1' },
    get spaces() {
      return world.remote
    },
    deletedSpaces: [],
    loadSpaces: () => Promise.resolve(),
  },
  api: {
    createSpace: (_token: string, name: string) => {
      world.made.push(name)
      return Promise.resolve({ space: { id: `r-${name}` } })
    },
    setSpaceIcon: () => Promise.resolve(),
    saveBookmarks: () => Promise.resolve(),
  },
}))
vi.mock('../../left-spaces/src/api', () => ({
  forgetHome: () => undefined,
  homeOf: () => null,
  keepHomes: () => undefined,
  leaveSpaces: () => undefined,
  leftByAnother: () => false,
}))
vi.mock('../../seeded/src/api', () => ({
  seedSpaceRoot: () => null,
  forgetSeedSpace: () => undefined,
}))
vi.mock('../../agents-seed/src/api', () => ({ isUntouchedAgents: () => false }))
vi.mock('../../sharing/src/api', () => ({
  rememberRoles: () => {
    world.remembered += 1
  },
}))
vi.mock('../../protect/src/api', () => ({ pulled: () => Promise.resolve() }))
vi.mock('../../space-owed/src/api', () => ({
  holder: () => null,
  endsOwed: () => new Set(),
  iconOwed: () => null,
  orderSent: () => Promise.resolve(false),
  sendIcon: () => Promise.resolve(),
  settleEnds: () => Promise.resolve(),
  settleNames: () => Promise.resolve(),
}))
vi.mock('../../platform/src/api', () => ({
  samePath: (one: string, other: string) => one === other,
  invoke: () => Promise.reject(new Error('no disk')),
  isNative: true,
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    restored: true,
    get spaces() {
      return world.local
    },
    spacesKnown: () => Promise.resolve(),
    loadSpaces: () => Promise.resolve(),
    deleteSpace: () => Promise.resolve(),
    adoptSpace: (name: string) => {
      world.local.push({ id: name, name, root: `/${name}` })
      return Promise.resolve(`/${name}`)
    },
    applyIcon: () => null,
    bookmarks: { adopt: () => null, said: () => undefined },
    applySpaceOrder: (roots: string[]) => {
      world.order = roots
    },
  },
}))
const { pairSpaces } = await import('../src/api')
function engine() {
  const pairs = new Map<string, { spaceId: string; shared: boolean }>()
  const pairing: SyncPairing = {
    pairs: () => [...pairs].map(([root, one]) => ({ root, ...one })),
    pair: (root, spaceId, shared) => void pairs.set(root, { spaceId, shared }),
    unpair: (root) => void pairs.delete(root),
    share: (root, shared) => {
      const one = pairs.get(root)
      if (one) pairs.set(root, { ...one, shared })
    },
  }
  return { pairing, pairs }
}
beforeEach(() => {
  world.local = []
  world.remote = []
  world.made = []
  world.remembered = 0
  world.order = []
})
describe('pairing the spaces on this device with the account s', () => {
  test('brings a space of the account onto the device and pairs it', async () => {
    world.remote = [{ id: 'r1', name: 'Work', role: 'owner' }]
    const { pairing, pairs } = engine()
    await pairSpaces('t', pairing)
    expect(world.local.map((one) => one.root)).toEqual(['/Work'])
    expect([...pairs]).toEqual([['/Work', { spaceId: 'r1', shared: false }]])
    expect(world.order).toEqual(['/Work'])
    expect(world.remembered).toBe(1)
  })
  test('makes a space the account lacks on the server and pairs it', async () => {
    world.local = [{ id: 'n', name: 'Notes', root: '/Notes' }]
    const { pairing, pairs } = engine()
    await pairSpaces('t', pairing)
    expect(world.made).toEqual(['Notes'])
    expect([...pairs]).toEqual([['/Notes', { spaceId: 'r-Notes', shared: false }]])
  })
  test('pairs a space of the same name instead of making a second', async () => {
    world.local = [{ id: 'n', name: 'Notes', root: '/Notes' }]
    world.remote = [{ id: 'r1', name: 'Notes', role: 'owner' }]
    const { pairing, pairs } = engine()
    await pairSpaces('t', pairing)
    expect(world.made).toEqual([])
    expect([...pairs]).toEqual([['/Notes', { spaceId: 'r1', shared: false }]])
  })
  test('a shared space is marked shared', async () => {
    world.remote = [{ id: 'r9', name: 'Team', role: 'write' }]
    const { pairing, pairs } = engine()
    await pairSpaces('t', pairing)
    expect(pairs.get('/Team')).toEqual({ spaceId: 'r9', shared: true })
  })
  test('asked twice at once, pairs once', async () => {
    world.local = [{ id: 'n', name: 'Notes', root: '/Notes' }]
    const { pairing } = engine()
    await Promise.all([pairSpaces('t', pairing), pairSpaces('t', pairing)])
    expect(world.made).toEqual(['Notes'])
    expect(world.remembered).toBe(1)
  })
})
describe('two engines pairing at once', () => {
  test('pair one after the other, so a space of the account comes down once', async () => {
    world.remote = [{ id: 'r1', name: 'Work', role: 'owner' }]
    const one = engine()
    const other = engine()
    await Promise.all([pairSpaces('t', one.pairing), pairSpaces('t', other.pairing)])
    expect(world.local.map((space) => space.root)).toEqual(['/Work'])
    expect(other.pairs.get('/Work')).toEqual({ spaceId: 'r1', shared: false })
  })
})
