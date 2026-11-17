import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  online: false,
  saved: [] as unknown[],
  signOut: [] as ((kept: boolean) => void)[],
  saves: [] as { done: () => void; fail: () => void }[] | null,
}))

vi.mock('../../accounts/src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../accounts/src/api')>()
  return {
    ...original,
    account: new Proxy(original.account, {
      get: (target, key) =>
        key === 'accountToken'
          ? 'token'
          : key === 'forgetWithSession'
            ? (clear: (kept: boolean) => void) => void world.signOut.push(clear)
            : (Reflect.get(target, key) as unknown),
    }),
    api: {
      saveSettings: (_token: string, patch: unknown) => {
        if (world.saves)
          return new Promise((resolve, reject) =>
            world.saves?.push({
              done: () => resolve({ settings: {} }),
              fail: () => reject(new Error('offline')),
            }),
          )
        if (!world.online) return Promise.reject(new Error('offline'))
        world.saved.push(patch)
        return Promise.resolve({ settings: {} })
      },
    },
  }
})

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
})

async function relaunched() {
  vi.resetModules()
  world.signOut = []
  const [{ shortcuts }, { toolbar }] = await Promise.all([
    import('./shortcuts.svelte'),
    import('./toolbar.svelte'),
  ])
  shortcuts.restore()
  toolbar.restore()
  return { shortcuts, toolbar }
}

beforeEach(() => {
  store.clear()
  world.online = false
  world.saved = []
  world.saves = null
})

test('a key rebound while the account could not be reached is sent at the next launch, not undone', async () => {
  const first = await relaunched()
  first.shortcuts.set('format.bold', 'Mod-Alt-b')
  await vi.waitFor(() => expect(store.get('orden:shortcuts-owed')).toBe('yes'))

  world.online = true
  const { shortcuts } = await relaunched()
  shortcuts.receive({ shortcuts: {}, preset: 'default' })

  expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  await vi.waitFor(() =>
    expect(world.saved).toEqual([{ shortcuts: { 'format.bold': 'Mod-Alt-b' }, preset: 'custom' }]),
  )
  expect(store.has('orden:shortcuts-owed')).toBe(false)
})

test('a toolbar laid out while the account could not be reached is sent at the next launch, not undone', async () => {
  const first = await relaunched()
  first.toolbar.add('paragraph.table')
  const laid = [...first.toolbar.ids]
  await vi.waitFor(() => expect(store.get('orden:toolbar-owed')).toBe('yes'))

  world.online = true
  const { toolbar } = await relaunched()
  toolbar.receive({ toolbar: null })

  expect(toolbar.ids).toEqual(laid)
  await vi.waitFor(() => expect(world.saved).toEqual([{ toolbar: laid }]))
})

test('what the account holds is taken when nothing is owed', async () => {
  world.online = true
  const { shortcuts } = await relaunched()
  shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
  expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
})

test('a key owed to one account is not carried into the next one signed in', async () => {
  const first = await relaunched()
  first.shortcuts.set('format.bold', 'Mod-Alt-b')
  await vi.waitFor(() => expect(store.get('orden:shortcuts-owed')).toBe('yes'))
  first.toolbar.add('paragraph.table')
  await vi.waitFor(() => expect(store.get('orden:toolbar-owed')).toBe('yes'))
  for (const clear of world.signOut) clear(false)

  world.online = true
  const { shortcuts } = await relaunched()
  shortcuts.receive({ shortcuts: { 'format.italic': 'Mod-Alt-i' }, preset: 'custom' })

  expect(shortcuts.keyFor('format.italic')).toBe('Mod-Alt-i')
  expect(world.saved).toEqual([])
  expect(store.has('orden:toolbar-owed')).toBe(false)
})

test('an older save landing after a newer one failed leaves the newer change owed', async () => {
  const { shortcuts } = await relaunched()
  world.saves = []
  shortcuts.set('format.bold', 'Mod-Alt-b')
  shortcuts.set('format.italic', 'Mod-Alt-i')
  const [older, newer] = world.saves
  newer?.fail()
  await vi.waitFor(() => expect(store.get('orden:shortcuts-owed')).toBe('yes'))
  older?.done()
  await new Promise((done) => setTimeout(done, 0))
  expect(store.get('orden:shortcuts-owed')).toBe('yes')
})
