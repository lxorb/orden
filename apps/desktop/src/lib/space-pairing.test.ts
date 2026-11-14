import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const world = vi.hoisted(() => ({
  spaces: [] as { id: string; name: string; root: string }[],
  made: [] as string[],
  icons: [] as string[],
  ended: [] as string[],
  order: [] as string[],
  onMade: null as (() => Promise<void>) | null,
  online: true,
  expired: false,
  blocked: false,
  adopted: [] as { name: string; fresh: boolean }[],
}))

vi.mock('./accounts/src/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./accounts/src/client')>()
  const { ApiError } = original
  return {
    ...original,
    api: {
      createSpace: async (_token: string, name: string) => {
        world.made.push(name)
        await world.onMade?.()
        return { space: { id: `made-${name}`, name } }
      },
      setSpaceIcon: (_token: string, id: string, icon: string | null) => {
        if (!world.online) return Promise.reject(new TypeError('Failed to fetch'))
        if (world.expired) return Promise.reject(new ApiError(401, 'sign in again'))
        world.ended.push(`icon ${id} ${icon}`)
        return Promise.resolve({ space: { id } })
      },
      deleteSpace: (_token: string, id: string) => {
        if (!world.online) return Promise.reject(new TypeError('Failed to fetch'))
        if (world.expired) return Promise.reject(new ApiError(401, 'sign in again'))
        if (world.blocked) return Promise.reject(new ApiError(403, 'request failed', '<html>'))
        world.ended.push(`delete ${id}`)
        return Promise.resolve({ ok: true })
      },
      leaveSpace: (_token: string, id: string) => {
        if (!world.online) return Promise.reject(new TypeError('Failed to fetch'))
        if (world.expired) return Promise.reject(new ApiError(401, 'sign in again'))
        world.ended.push(`leave ${id}`)
        return Promise.resolve({ ok: true })
      },
      saveBookmarks: () => Promise.resolve(),
      reorderSpaces: (_token: string, order: string[]) => {
        if (!world.online) return Promise.reject(new TypeError('Failed to fetch'))
        if (world.expired) return Promise.reject(new ApiError(401, 'sign in again'))
        world.ended.push(`order ${order.join(' ')}`)
        return Promise.resolve({ ok: true })
      },
    },
  }
})

vi.mock('./platform/src/tauri', () => ({
  invoke: () => Promise.reject(new Error('no disk here')),
  isNative: true,
  isDesktop: true,
  platform: () => 'windows',
  joinPath: (...parts: string[]) => parts.join('/'),
}))

vi.mock('./seeded', () => ({ seedSpaceRoot: () => null, forgetSeedSpace: () => undefined }))
vi.mock('./seed-space', () => ({ untouchedSeedSpace: () => Promise.resolve(null) }))
vi.mock('./sharing/src/api', () => ({ rememberRoles: () => undefined }))
vi.mock('./protect/src/synced', () => ({ pulled: () => undefined }))

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
    applySpaceOrder: (roots: string[]) => {
      world.order = roots
    },
  },
}))

const { account } = await import('./accounts/src/account.svelte')
const { pairSpaces } = await import('./space-pairing')
const { leaveSpaces, leftBy } = await import('./left-spaces')
const { endSpace, endsOwed, holder, iconOwed, sendIcon, sendOrder } = await import('./space-owed')

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
  world.ended = []
  world.online = true
  world.expired = false
  world.blocked = false
  world.onMade = null
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

describe('a space deleted while the account could not be reached', () => {
  test('is not brought back down, and the account is told once it answers', async () => {
    world.spaces = [{ id: '2', name: 'Fresh', root: '/Fresh' }]
    signedIn('a', ['Fresh', 'Gone'])
    world.online = false
    await endSpace('token-a', 'a', 'a-Gone', 'delete')
    expect(endsOwed('a')).toEqual(new Set(['a-Gone']))

    const { pairs, pairing: held } = pairing()
    pairs.push({ root: '/Fresh', spaceId: 'a-Fresh', shared: false })
    await pairSpaces('token-a', held)

    expect(world.adopted).toEqual([])
    expect(endsOwed('a')).toEqual(new Set(['a-Gone']))

    world.online = true
    await pairSpaces('token-a', held)

    expect(world.adopted).toEqual([])
    expect(world.ended).toEqual(['delete a-Gone'])
    expect(endsOwed('a')).toEqual(new Set())
  })

  test('and one left is left once the account answers, for that account only', async () => {
    world.spaces = []
    signedIn('a', ['Theirs'])
    world.online = false
    await endSpace('token-a', 'a', 'a-Theirs', 'leave')
    expect(endsOwed('b')).toEqual(new Set())

    world.online = true
    const { pairing: held } = pairing()
    await pairSpaces('token-a', held)

    expect(world.ended).toEqual(['leave a-Theirs'])
    expect(world.adopted).toEqual([])
  })
})

describe('a space deleted while something in the way answered for the account', () => {
  test('is still owed, and the account is told once it answers', async () => {
    world.spaces = []
    signedIn('a', ['Gone'])
    world.blocked = true
    await endSpace('token-a', 'a', 'a-Gone', 'delete')
    expect(endsOwed('a')).toEqual(new Set(['a-Gone']))

    world.blocked = false
    const { pairing: held } = pairing()
    await pairSpaces('token-a', held)

    expect(world.ended).toEqual(['delete a-Gone'])
    expect(endsOwed('a')).toEqual(new Set())
  })
})

describe('a space ended while the sign-in had run out', () => {
  test('is still owed, and is not brought back down once the account is in again', async () => {
    world.spaces = [{ id: '2', name: 'Fresh', root: '/Fresh' }]
    signedIn('a', ['Fresh', 'Gone'])
    world.expired = true
    await endSpace('token-a', 'a', 'a-Gone', 'delete')
    await endSpace('token-a', 'a', 'a-Fresh', 'leave')
    expect(endsOwed('a')).toEqual(new Set(['a-Gone', 'a-Fresh']))

    world.expired = false
    const { pairing: held } = pairing()
    await pairSpaces('token-a', held)

    expect(world.ended).toEqual(['delete a-Gone', 'leave a-Fresh'])
    expect(world.adopted).toEqual([])
    expect(endsOwed('a')).toEqual(new Set())
  })

  test('keeps its icon and the order chosen for when the account is in again', async () => {
    world.spaces = [{ id: '1', name: 'Work', root: '/Work' }]
    signedIn('a', ['Work'])
    world.expired = true
    await sendIcon('token-a', 'a', 'a-Work', { icon: 'star', tint: null })
    await sendOrder('token-a', 'a', ['a-Work'])
    expect(iconOwed('a', 'a-Work')).toEqual({ icon: 'star', tint: null })

    world.expired = false
    const { pairs, pairing: held } = pairing()
    pairs.push({ root: '/Work', spaceId: 'a-Work', shared: false })
    await pairSpaces('token-a', held)

    expect(world.ended).toEqual(expect.arrayContaining(['icon a-Work star', 'order a-Work']))
    expect(iconOwed('a', 'a-Work')).toBeNull()
  })
})

describe('the order the account keeps', () => {
  test('is put on the spaces it pairs, whatever each is called on this device', async () => {
    world.spaces = [
      { id: '1', name: 'Job', root: '/Job' },
      { id: '2', name: 'Home', root: '/Home' },
    ]
    signedIn('a', ['Home', 'Work'])
    const { pairs, pairing: held } = pairing()
    pairs.push({ root: '/Job', spaceId: 'a-Work', shared: false })
    pairs.push({ root: '/Home', spaceId: 'a-Home', shared: false })

    await pairSpaces('token-a', held)

    expect(world.order).toEqual(['/Home', '/Job'])
  })
})

describe('an icon chosen while the account could not be reached', () => {
  test('stays, and reaches the account once it answers', async () => {
    world.spaces = [{ id: '1', name: 'Work', root: '/Work' }]
    signedIn('a', ['Work'])
    world.online = false
    await sendIcon('token-a', 'a', 'a-Work', { icon: 'star', tint: null })
    const { pairs, pairing: held } = pairing()
    pairs.push({ root: '/Work', spaceId: 'a-Work', shared: false })

    await pairSpaces('token-a', held)

    expect(world.icons).toEqual([])
    expect(iconOwed('a', 'a-Work')).toEqual({ icon: 'star', tint: null })

    world.online = true
    await pairSpaces('token-a', held)

    expect(world.icons).toEqual([])
    expect(world.ended).toEqual(['icon a-Work star'])
    expect(iconOwed('a', 'a-Work')).toBeNull()

    await pairSpaces('token-a', held)
    expect(world.icons).toEqual(['/Work'])
  })
})

test('a space deleted while the device pairs is not brought back by that same pairing', async () => {
  world.spaces = [{ id: '2', name: 'Fresh', root: '/Fresh' }]
  signedIn('a', ['Gone'])
  world.online = false
  world.onMade = () => endSpace('token-a', 'a', 'a-Gone', 'delete')
  const { pairing: held } = pairing()

  await pairSpaces('token-a', held)

  expect(world.made).toEqual(['Fresh'])
  expect(world.adopted).toEqual([])
})

test('an order chosen while the account could not be reached is not undone by it', async () => {
  world.spaces = [
    { id: '1', name: 'Work', root: '/Work' },
    { id: '2', name: 'Home', root: '/Home' },
  ]
  signedIn('a', ['Work', 'Home'])
  const { pairs, pairing: held } = pairing()
  pairs.push({ root: '/Work', spaceId: 'a-Work', shared: false })
  pairs.push({ root: '/Home', spaceId: 'a-Home', shared: false })
  world.online = false
  await sendOrder('token-a', 'a', ['a-Home', 'a-Work'])

  await pairSpaces('token-a', held)
  expect(world.order).toEqual([])

  world.online = true
  await pairSpaces('token-a', held)
  expect(world.ended).toEqual(['order a-Home a-Work'])
  expect(world.order).toEqual([])

  await pairSpaces('token-a', held)
  expect(world.order).toEqual(['/Work', '/Home'])
})

test('a guest who left a space while away leaves it once the account answers', async () => {
  world.spaces = []
  account.user = null
  account.guest = { id: 'g1', name: 'Ada' }
  account.token = 'token-g'
  account.spaces = [{ id: 'theirs', name: 'Theirs', role: 'write' }] as never
  const who = holder()
  expect(who).toBe('guest:g1')
  world.online = false
  await endSpace('token-g', who ?? '', 'theirs', 'leave')

  world.online = true
  const { pairing: held } = pairing()
  await pairSpaces('token-g', held)

  expect(world.ended).toEqual(['leave theirs'])
  expect(world.adopted).toEqual([])
  account.guest = null
})
