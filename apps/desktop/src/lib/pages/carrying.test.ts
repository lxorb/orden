import { beforeEach, expect, test, vi } from 'vitest'

/** Carrying started over for a new session: a paper held back by the session before it,
 *  by a 401 or a run of failures, goes at the first carrying of the new one rather than
 *  minutes later. */

const world = vi.hoisted(() => ({
  account: { token: 'first', user: { id: 'u1' } },
  puts: 0,
  answer: (): Promise<unknown> => Promise.resolve({}),
}))

vi.mock('../account.svelte', () => ({ account: world.account }))
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
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    putBlob: () => {
      world.puts += 1
      return world.answer()
    },
    holdPaper: () => Promise.resolve({}),
  },
}))

const { ApiError } = await import('../api')
const { carryNow } = await import('./carrying')

const NOTES = () => [{ path: '/s/Lecture.pages', id: 'n1', writes: true, space: 'Work' }]
const said = () => undefined

beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'] }))

test('a new sign-in carries at once what the old session was refused or failed at', async () => {
  world.answer = () => Promise.reject(new ApiError(401, 'signed out'))
  await carryNow(NOTES, said)
  expect(world.puts).toBe(1)

  // Past the least time between two carryings, and well inside any wait.
  vi.setSystemTime(Date.now() + 3_001)
  await carryNow(NOTES, said)
  expect(world.puts).toBe(1)

  world.account.token = 'second'
  world.answer = () => Promise.resolve({})
  vi.setSystemTime(Date.now() + 3_001)
  await carryNow(NOTES, said)
  expect(world.puts).toBe(2)
})
