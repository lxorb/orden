import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  account: { token: 'first', user: { id: 'u1' } },
  puts: 0,
  answer: (): Promise<unknown> => Promise.resolve({}),
}))

vi.mock('../accounts/src/account.svelte', () => ({ account: world.account }))
vi.mock('../workspace.svelte', () => ({ workspace: { spaces: [] } }))
vi.mock('../bytes', () => ({
  fileBytes: () => Promise.resolve(new Uint8Array(3)),
  sha256: () => Promise.resolve('hash'),
  toBase64: () => '',
}))
vi.mock('../tauri', () => ({
  isNative: true,
  joinPath: (root: string, path: string) => `${root}/${path}`,
  invoke: () => Promise.resolve({ modified: 1, size: 3 }),
}))
vi.mock('../accounts/src/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../accounts/src/client')>()),
  api: {
    putBlob: () => {
      world.puts += 1
      return world.answer()
    },
    holdPaper: () => Promise.resolve({}),
  },
}))

const { ApiError } = await import('../accounts/src/client')
const { carryNow } = await import('./carrying')

const NOTES = () => [{ path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }]
const said = () => undefined

beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }))

test('a new sign-in carries at once what the old session was refused or failed at', async () => {
  world.answer = () => Promise.reject(new ApiError(401, 'signed out'))
  await carryNow(NOTES, said)
  expect(world.puts).toBe(1)

  vi.setSystemTime(Date.now() + 3_001)
  await carryNow(NOTES, said)
  expect(world.puts).toBe(1)

  world.account.token = 'second'
  world.answer = () => Promise.resolve({})
  vi.setSystemTime(Date.now() + 3_001)
  await carryNow(NOTES, said)
  expect(world.puts).toBe(2)
})
