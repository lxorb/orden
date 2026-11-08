import { describe, expect, test, vi } from 'vitest'

const forgotten = vi.hoisted(() => [] as string[])
vi.mock('./store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store')>()),
  forgetSyncStore: (id: string) => {
    forgotten.push(id)
    return Promise.resolve()
  },
}))

const devices = vi.hoisted(() => ({
  asked: 0,
  answer: (): Promise<unknown> => Promise.resolve({ devices: [] }),
}))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  request: () => {
    devices.asked += 1
    return devices.answer()
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { runner } = await import('./runner.svelte')

function engineWithOneSpace() {
  let open = true
  const store = {
    read: async (gets: readonly unknown[]) => {
      await new Promise((settle) => setTimeout(settle, 5))
      if (!open) throw new Error('the sync store is not open')
      return gets.map(() => ({ key: 'first', value: 1 }))
    },
    close: () => {
      open = false
      return Promise.resolve()
    },
  }
  const space = { id: 's1', row: { root: '/Notes', role: 'owner' }, entries: new Map() }
  return {
    core: { spaces: new Map([['s1', space]]), store, isHeld: () => false, world: {} },
    quit: () => Promise.resolve(),
    stop: () => undefined,
  }
}

describe('signing out', () => {
  test('writes the mirrors before the store is closed, though syncing stops at once', async () => {
    Object.assign(runner, { current: engineWithOneSpace() })

    const leaving = runner.signedOut('u1')
    const stopping = runner.stop()
    await Promise.all([leaving, stopping])

    const kept = JSON.parse(localStorage.getItem('orden:mirrors') ?? 'null') as {
      account: string
      mirrors: Record<string, { spaceId: string }>
    } | null
    expect(kept?.account).toBe('u1')
    expect(kept?.mirrors['/Notes']?.spaceId).toBe('s1')
    expect(forgotten).toEqual(['u1'])
  })
})

function engineWithSpaces(waiting: ReadonlySet<string>) {
  const store = {
    read: (gets: readonly unknown[]) => Promise.resolve(gets.map(() => ({ key: 'first' }))),
    close: () => Promise.resolve(),
  }
  const spaces = new Map(
    ['Notes', 'Draft'].map((name) => [
      name,
      { id: name, row: { root: `/${name}`, role: 'owner' }, entries: new Map() },
    ]),
  )
  return {
    core: { spaces, store, isHeld: () => false, world: {} },
    waiting: (id: string) => waiting.has(id),
    quit: () => Promise.resolve(),
    stop: () => undefined,
  }
}

describe('a browser signed out of', () => {
  test('drops the spaces whose every change reached the account and keeps the rest for it alone', async () => {
    const { workspace } = await import('../workspace.svelte')
    const { leftBy, leftByAnother } = await import('../left-spaces')
    workspace.spaces = [
      { id: '1', name: 'Notes', root: '/Notes' },
      { id: '2', name: 'Draft', root: '/Draft' },
    ]
    const dropped: string[] = []
    const drop = vi.spyOn(workspace, 'dropSpace').mockImplementation((id) => {
      dropped.push(id)
      workspace.spaces = workspace.spaces.filter((one) => one.id !== id)
      return Promise.resolve()
    })
    Object.assign(runner, { current: engineWithSpaces(new Set(['Draft'])) })

    await runner.signedOut('u2')

    expect(dropped).toEqual(['1'])
    expect(leftBy('/Notes')).toBe(null)
    expect(leftBy('/Draft')).toBe('u2')
    expect(leftByAnother('/Draft', 'someone else')).toBe(true)
    drop.mockRestore()
  })

  test('keeps every space, as nobody’s, when the account itself was deleted', async () => {
    const { workspace } = await import('../workspace.svelte')
    const { leaveSpaces, leftBy } = await import('../left-spaces')
    workspace.spaces = [{ id: '1', name: 'Notes', root: '/Notes' }]
    leaveSpaces('u3', ['/Notes'])
    const drop = vi.spyOn(workspace, 'dropSpace')
    Object.assign(runner, { current: engineWithSpaces(new Set()) })

    await runner.signedOut('u3', true)

    expect(drop).not.toHaveBeenCalled()
    expect(leftBy('/Notes')).toBe(null)
    drop.mockRestore()
  })
})

describe("a device's name", () => {
  const nameOf = (device: string) =>
    (runner as unknown as { nameOf(device: string): Promise<string> }).nameOf(device)

  test('is asked for once by everyone who wants it at once, and a failure is not kept', async () => {
    const { account } = await import('../account.svelte')
    account.token = 't1'
    Object.assign(account, { user: { id: 'u1' } })
    Object.assign(runner, { names: null, accountId: 'u1' })
    devices.asked = 0

    let answer: (value: unknown) => void = () => undefined
    devices.answer = () => new Promise((settle) => (answer = settle))
    const first = nameOf('d1')
    const second = nameOf('d1')
    await new Promise((settle) => setTimeout(settle, 0))
    answer({ devices: [{ id: 'd1', name: 'Laptop' }] })
    expect(await Promise.all([first, second])).toEqual(['Laptop', 'Laptop'])
    expect(devices.asked).toBe(1)

    Object.assign(runner, { names: null })
    devices.answer = () => Promise.reject(new Error('offline'))
    expect(await nameOf('d1')).toBe('')
    devices.answer = () => Promise.resolve({ devices: [{ id: 'd1', name: 'Laptop' }] })
    expect(await nameOf('d1')).toBe('Laptop')
  })

  test('is asked again of the account signed in after another', async () => {
    const { account } = await import('../account.svelte')
    account.token = 't1'
    Object.assign(account, { user: { id: 'u1' } })
    Object.assign(runner, { names: null, accountId: 'u1' })
    devices.answer = () => Promise.resolve({ devices: [{ id: 'd1', name: 'Laptop' }] })
    expect(await nameOf('d1')).toBe('Laptop')

    account.token = 't2'
    Object.assign(account, { user: { id: 'u2' } })
    expect(await nameOf('d1')).toBe('')

    Object.assign(runner, { accountId: 'u2' })
    devices.answer = () => Promise.resolve({ devices: [{ id: 'd1', name: 'Phone' }] })
    expect(await nameOf('d1')).toBe('Phone')
  })
})
