import { expect, test, vi } from 'vitest'
import '../test/storage'

type Ways = Record<string, string>

const server = vi.hoisted(() => {
  const spaces: Record<string, Record<string, string>> = {}
  return { spaces, id: 's1' }
})

const merged = (held: Ways, base: Ways, sent: Ways) => {
  const out = Object.fromEntries(
    Object.entries(held).filter(([key]) => !(key in base) || key in sent),
  )
  for (const [key, way] of Object.entries(sent)) if (base[key] !== way) out[key] = way
  return out
}

vi.mock('../../accounts/src/api', () => ({
  account: { token: 'token', user: { id: 'u1' } },
  request: (path: string, options: { method?: string; body?: unknown } = {}) => {
    if (options.method === 'PUT') {
      const id = decodeURIComponent(path.split('/').pop() ?? '')
      const body = options.body as { protected: Ways; base?: Ways }
      const held = server.spaces[id] ?? {}
      server.spaces[id] = body.base ? merged(held, body.base, body.protected) : body.protected
      return Promise.resolve({ password: null, spaces: { ...server.spaces } })
    }
    return Promise.resolve({ password: null, spaces: { ...server.spaces } })
  },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  syncStore: () => ({ remoteIdFor: () => server.id }),
}))

const { protection } = await import('./protection.svelte')
const { pulled } = await import('./synced')

const ROOT = '/space'
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((go) => setTimeout(go, 0))
}

test('a space paired again under a new account space keeps its locks, here and there', async () => {
  await pulled('token', 'u1', [{ root: ROOT, spaceId: 's1' }])
  await settle()
  protection.set(ROOT, `${ROOT}/Diary.md`, 'password')
  await settle()
  expect(server.spaces.s1).toEqual({ 'Diary.md': 'password' })
  await pulled('token', 'u1', [{ root: ROOT, spaceId: 's1' }])
  await settle()
  expect(protection.locked(`${ROOT}/Diary.md`)).toBe(true)

  server.id = 's2'
  await pulled('token', 'u1', [{ root: ROOT, spaceId: 's2' }])
  await settle()
  expect(protection.ways(ROOT)).toEqual({ 'Diary.md': 'password' })
  expect(protection.agentsMay(`${ROOT}/Diary.md`)).toBe(false)
  expect(server.spaces.s2).toEqual({ 'Diary.md': 'password' })
})
