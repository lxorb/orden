import { expect, test, vi } from 'vitest'
import '../test/storage'

type Ways = Record<string, string>

const server = vi.hoisted(() => ({
  held: {},
  down: true,
  puts: [] as { body: { protected: Ways; base?: Ways }; land: () => void }[],
}))

const merged = (held: Ways, base: Ways, sent: Ways) => {
  const out = Object.fromEntries(Object.entries(held).filter(([key]) => !(key in base) || key in sent))
  for (const [key, way] of Object.entries(sent)) if (base[key] !== way) out[key] = way
  return out
}

vi.mock('../../accounts/src/api', () => ({
  account: { token: 'token', user: { id: 'u1' } },
  request: (_path: string, options: { method?: string; body?: unknown } = {}) => {
    if (options.method === 'PUT') {
      return new Promise((resolve) => {
        const body = options.body as { protected: Ways; base?: Ways }
        server.puts.push({
          body,
          land: () => {
            server.held = body.base ? merged(server.held, body.base, body.protected) : body.protected
            resolve({ password: null, spaces: { s1: server.held } })
          },
        })
      })
    }
    if (server.down) return Promise.reject(new Error('offline'))
    return Promise.resolve({ password: null, spaces: { s1: server.held } })
  },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  syncStore: () => ({ remoteIdFor: () => 's1' }),
}))

const { protection } = await import('./protection.svelte')
const { pulled } = await import('./synced')

const ROOT = '/space'
const PAIRS = [{ root: ROOT, spaceId: 's1' }]
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((go) => setTimeout(go, 0))
}

test('a lock set before the first lock pull lands keeps the locks the account holds', async () => {
  server.held = { Private: 'password', 'Taxes.md': 'device' }
  await pulled('token', 'u1', PAIRS)
  await settle()
  protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
  await settle()
  for (const one of server.puts) one.land()
  await settle()
  expect(server.held).toEqual({ Private: 'password', 'Taxes.md': 'device' })
  server.down = false
  protection.set(ROOT, `${ROOT}/Notes.md`, 'password')
  await settle()
  for (const one of server.puts) one.land()
  await settle()
  expect(server.held).toEqual({
    Private: 'password',
    'Taxes.md': 'device',
    'Diary.md': 'password',
    'Notes.md': 'password',
  })
  expect(protection.locked(`${ROOT}/Private`)).toBe(true)
})
