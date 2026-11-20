import { beforeEach, describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const world = vi.hoisted(() => {
  class Said extends Error {
    constructor(readonly status: number) {
      super(`said ${status}`)
    }
  }
  return {
    Said,
    user: null as { id: string } | null,
    guest: null as { id: string } | null,
    answer: 0,
    asked: [] as string[],
    kept: undefined as { icon: string | null; tint?: string | null } | undefined,
  }
})
vi.mock('../../accounts/src/api', () => {
  const ask = (what: string) => () => {
    world.asked.push(what)
    if (world.answer === 0) return Promise.reject(new Error('offline'))
    if (world.answer !== 200) return Promise.reject(new world.Said(world.answer))
    return Promise.resolve(what === 'icon' && world.kept ? { space: world.kept } : undefined)
  }
  return {
    account: {
      get user() {
        return world.user
      },
      get guest() {
        return world.guest
      },
    },
    api: {
      leaveSpace: ask('leave'),
      deleteSpace: ask('delete'),
      setSpaceIcon: ask('icon'),
      renameSpace: ask('name'),
      reorderSpaces: ask('order'),
    },
    fromServer: (error: unknown) => error instanceof world.Said,
  }
})
const owed = await import('../src/api')
beforeEach(() => {
  held.clear()
  world.user = null
  world.guest = null
  world.answer = 0
  world.asked = []
  world.kept = undefined
})
describe('who owes the server', () => {
  test('is the person signed in, else the guest, else nobody', () => {
    expect(owed.holder()).toBeNull()
    world.guest = { id: 'g1' }
    expect(owed.holder()).toBe('guest:g1')
    world.user = { id: 'u1' }
    expect(owed.holder()).toBe('u1')
  })
})
describe('what the server did not hear', () => {
  test('a space ended offline stays owed until the server takes it', async () => {
    await owed.endSpace('t', 'u1', 's1', 'delete')
    expect(owed.endsOwed('u1')).toEqual(new Set(['s1']))
    expect(owed.endsOwed('u2')).toEqual(new Set())
    world.answer = 200
    await owed.settleEnds('t', 'u1')
    expect(world.asked).toEqual(['delete', 'delete'])
    expect(owed.endsOwed('u1')).toEqual(new Set())
  })
  test('a refusal settles it, a server that is struggling does not', async () => {
    world.answer = 503
    await owed.endSpace('t', 'u1', 's1', 'leave')
    expect(owed.endsOwed('u1')).toEqual(new Set(['s1']))
    world.answer = 403
    await owed.settleEnds('t', 'u1')
    expect(owed.endsOwed('u1')).toEqual(new Set())
  })
  test('an icon is owed until sent', async () => {
    await owed.sendIcon('t', 'u1', 's1', { icon: 'star', tint: null })
    expect(owed.iconOwed('u1', 's1')).toEqual({ icon: 'star', tint: null })
    world.answer = 200
    await owed.sendIcon('t', 'u1', 's1', { icon: 'star', tint: null })
    expect(owed.iconOwed('u1', 's1')).toBeNull()
  })
  test('a chosen icon the server will not keep stays owed, so the server never takes it back (#2329)', async () => {
    const picture = { icon: 'data:image/png;base64,iVBORw0KGgo=', tint: null }
    world.answer = 400
    await owed.sendIcon('t', 'u1', 's1', picture)
    expect(owed.iconOwed('u1', 's1')).toEqual(picture)
    world.answer = 200
    world.kept = { icon: 'star', tint: null }
    await owed.sendIcon('t', 'u1', 's1', picture)
    expect(owed.iconOwed('u1', 's1')).toEqual(picture)
    world.kept = { icon: picture.icon, tint: 'violet' }
    await owed.sendIcon('t', 'u1', 's1', picture)
    expect(owed.iconOwed('u1', 's1')).toEqual(picture)
    world.kept = { icon: picture.icon, tint: null }
    await owed.sendIcon('t', 'u1', 's1', picture)
    expect(owed.iconOwed('u1', 's1')).toBeNull()
  })
  test('and one it kept is paid, its colour kept with it', async () => {
    world.answer = 200
    world.kept = { icon: 'star', tint: 'violet' }
    await owed.sendIcon('t', 'u1', 's1', { icon: 'star', tint: 'violet' })
    expect(owed.iconOwed('u1', 's1')).toBeNull()
    world.kept = { icon: null, tint: null }
    await owed.sendIcon('t', 'u1', 's1', { icon: null, tint: null })
    expect(owed.iconOwed('u1', 's1')).toBeNull()
  })
  test('names and the order of spaces are sent again once heard', async () => {
    await owed.sendName('t', 'u1', 's1', 'Work')
    await owed.sendOrder('t', 'u1', ['s2', 's1'])
    world.answer = 200
    await owed.settleNames('t', 'u1')
    expect(await owed.orderSent('t', 'u1')).toBe(true)
    expect(await owed.orderSent('t', 'u1')).toBe(false)
    expect(world.asked).toEqual(['name', 'order', 'name', 'order'])
  })
})
