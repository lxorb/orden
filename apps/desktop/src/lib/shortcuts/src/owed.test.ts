import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ online: false, saved: [] as unknown[] }))

vi.mock('../../accounts/src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../accounts/src/api')>()
  return {
    ...original,
    account: new Proxy(original.account, {
      get: (target, key) =>
        key === 'accountToken' ? 'token' : (Reflect.get(target, key) as unknown),
    }),
    api: {
      saveSettings: (_token: string, patch: unknown) => {
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
