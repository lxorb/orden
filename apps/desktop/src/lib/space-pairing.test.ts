import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const world = vi.hoisted(() => ({
  spaces: [] as { id: string; name: string; root: string }[],
  made: [] as string[],
  icons: [] as string[],
  adopted: [] as { name: string; fresh: boolean }[],
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: {
    createSpace: (_token: string, name: string) => {
      world.made.push(name)
      return Promise.resolve({ space: { id: `made-${name}`, name } })
    },
    setSpaceIcon: () => Promise.resolve(),
    saveBookmarks: () => Promise.resolve(),
  },
}))

vi.mock('./tauri', () => ({
  invoke: () => Promise.reject(new Error('no disk here')),
  isNative: true,
  isDesktop: true,
  platform: () => 'windows',
  joinPath: (...parts: string[]) => parts.join('/'),
}))

vi.mock('./seeded', () => ({ seedSpaceRoot: () => null, forgetSeedSpace: () => undefined }))
vi.mock('./seed-space', () => ({ untouchedSeedSpace: () => Promise.resolve(null) }))
vi.mock('./sharing.svelte', () => ({ rememberRoles: () => undefined }))
vi.mock('./protect/synced', () => ({ pulled: () => undefined }))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return world.spaces
    },
    loadSpaces: () => Promise.resolve(),
    deleteSpace: () => Promise.resolve(),
    adoptSpace: (name: string, fresh: boolean) => {
      world.adopted.push({ name, fresh })
      const existing = fresh ? undefined : world.spaces.find((one) => one.name === name)
      if (existing) return Promise.resolve(existing.root)
      const root = `/${name} 2`
      world.spaces.push({ id: root, name: `${name} 2`, root })
      return Promise.resolve(root)
    },
    applyIcon: (root: string) => {
      world.icons.push(root)
      return null
    },
    bookmarks: { adopt: () => null, said: () => undefined },
    applySpaceOrder: () => undefined,
  },
}))

const { account } = await import('./account.svelte')
const { pairSpaces } = await import('./space-pairing')
const { leaveSpaces, leftBy } = await import('./left-spaces')

function pairing() {
  const pairs: { root: string; spaceId: string; shared: boolean }[] = []
  return {
    pairs,
    pairing: {
      pairs: () => pairs,
      pair: (root: string, spaceId: string, shared: boolean) =>
        void pairs.push({ root, spaceId, shared }),
      unpair: () => undefined,
      share: () => undefined,
    },
  }
}

function signedIn(id: string, spaces: string[]) {
  account.user = { id, email: `${id}@example.com` } as typeof account.user
  account.token = `token-${id}`
  account.spaces = spaces.map((name) => ({ id: `${id}-${name}`, name, role: 'owner' })) as never
  account.deletedSpaces = []
}

beforeEach(() => {
  localStorage.clear()
  world.spaces = [
    { id: '1', name: 'Hunt out', root: '/Hunt out' },
    { id: '2', name: 'Fresh', root: '/Fresh' },
  ]
  world.made = []
  world.adopted = []
  world.icons = []
})

describe('signing in on a device another account signed out of', () => {
  test('neither uploads nor pairs by name the spaces that account left here', async () => {
    leaveSpaces('a', ['/Hunt out'])
    signedIn('b', ['Hunt out'])
    const { pairs, pairing: held } = pairing()

    await pairSpaces('token-b', held)

    expect(world.made).toEqual(['Fresh'])
    expect(pairs.some((one) => one.root === '/Hunt out')).toBe(false)
    expect(world.adopted).toEqual([{ name: 'Hunt out', fresh: true }])
    expect(pairs).toContainEqual({ root: '/Hunt out 2', spaceId: 'b-Hunt out', shared: false })
    expect(leftBy('/Hunt out')).toBe('a')
    expect(leftBy('/Fresh')).toBe('b')
  })

  test('gives them back to the account that left them', async () => {
    leaveSpaces('a', ['/Hunt out'])
    signedIn('a', ['Hunt out'])
    const { pairs, pairing: held } = pairing()

    await pairSpaces('token-a', held)

    expect(pairs).toContainEqual({ root: '/Hunt out', spaceId: 'a-Hunt out', shared: false })
    expect(world.made).toEqual(['Fresh'])
    expect(leftBy('/Hunt out')).toBe('a')
  })
})

describe('a space sync keeps under another spelling of its folder', () => {
  test('wears its icon under the folder this device shows', async () => {
    world.spaces = [{ id: '1', name: 'Work', root: 'C:\\Users\\Ada\\Work' }]
    signedIn('a', ['Work'])
    const { pairs, pairing: held } = pairing()
    pairs.push({ root: 'c:/users/ada/work/', spaceId: 'a-Work', shared: false })

    await pairSpaces('token-a', held)

    expect(world.icons).toEqual(['C:\\Users\\Ada\\Work'])
    expect(world.made).toEqual([])
    expect(pairs).toHaveLength(1)
  })
})
