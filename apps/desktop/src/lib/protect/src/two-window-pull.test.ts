import { expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  stored: {},
  puts: [] as { body: unknown; land: () => void }[],
  holdGet: false,
  gets: [] as (() => void)[],
}))

vi.mock('../../accounts/src/api', () => ({
  account: { token: 'token', user: { id: 'u1' } },
  request: (_path: string, options: { method?: string; body?: unknown } = {}) => {
    if (options.method === 'PUT') {
      return new Promise((resolve) => {
        const body = options.body as { protected: Record<string, unknown> }
        server.puts.push({
          body,
          land: () => {
            server.stored = { s1: body.protected }
            resolve({ password: null, spaces: server.stored })
          },
        })
      })
    }
    const snapshot = { password: null, spaces: server.stored }
    if (server.holdGet) return new Promise((go) => server.gets.push(() => go(snapshot)))
    return Promise.resolve(snapshot)
  },
}))

vi.mock('@orden/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/contracts')>()),
  syncStore: () => ({ remoteIdFor: () => 's1' }),
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

const page = new EventTarget()
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('window', page)

const main = {
  ...(await import('./protection.svelte')),
  ...(await import('./synced')),
}
vi.resetModules()
const second = {
  ...(await import('./protection.svelte')),
  ...(await import('./synced')),
}

const ROOT = '/space'
const DIARY = `${ROOT}/Diary.md`
const PAIRS = [{ root: ROOT, spaceId: 's1' }]
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((go) => setTimeout(go, 0))
}
const told = () =>
  page.dispatchEvent(Object.assign(new Event('storage'), { key: main.STORAGE_KEY }))

test('a pull another window’s push overtook keeps the lock that push landed', async () => {
  expect(main.protection).not.toBe(second.protection)
  await main.pulled('token', 'u1', PAIRS)
  await settle()

  server.holdGet = true
  const pulling = main.pulled('token', 'u1', PAIRS)
  await settle()

  second.protection.set(ROOT, DIARY, 'password')
  told()
  await settle()
  server.puts[0]?.land()
  await settle()
  told()

  server.gets[0]?.()
  await pulling
  await settle()
  told()
  expect(main.protection.agentsMay(DIARY)).toBe(false)
  expect(second.protection.locked(DIARY)).toBe(true)
  expect(new main.Protection().ways(ROOT)).toEqual({ 'Diary.md': 'password' })
})
