import { afterAll, describe, expect, test, vi } from 'vitest'

const { ran } = vi.hoisted(() => ({ ran: [] as string[] }))

vi.mock('@orden/bases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/bases')>()),
  readBase: () => ({ orden: { id: 'tasks' } }),
  readAutomations: () => [],
}))
vi.mock('./automate', () => ({
  planned: () => {
    ran.push('planned')
    return { writes: [], moves: [], notices: [] }
  },
}))
vi.mock('./act', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./act')>()),
  writeEach: async () => false,
}))
vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'shared', name: 'Shared', root: '/s/Shared' }],
    activeSpace: { id: 'shared', name: 'Shared', root: '/s/Shared' },
  },
}))
vi.mock('../../rows/src/rows.svelte', () => ({ rows: { ready: true, of: () => [] } }))
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: async () => undefined,
}))
vi.mock('../reminders/platform', () => ({ show: () => undefined }))
vi.mock('../../sharing/src/api', () => ({
  canWriteAt: () => true,
  trustsHtmlAt: () => true,
}))

function sharedLocks(): LockManager {
  const holders = new Set<string>()
  const waiting = new Map<string, (() => void)[]>()
  const release = (name: string) => {
    holders.delete(name)
    waiting.get(name)?.shift()?.()
  }
  return {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => Promise<unknown> | undefined
      const options = (rest.length > 1 ? rest[0] : {}) as {
        ifAvailable?: boolean
        signal?: AbortSignal
      }
      if (options.ifAvailable && holders.has(name)) return Promise.resolve(run(null))
      return new Promise((resolve, reject) => {
        const go = () => {
          holders.add(name)
          void Promise.resolve(run({ name })).then((value) => {
            release(name)
            resolve(value)
          })
        }
        if (!holders.has(name)) {
          go()
          return
        }
        const queue = waiting.get(name) ?? []
        waiting.set(name, queue)
        queue.push(go)
        options.signal?.addEventListener('abort', () => {
          queue.splice(queue.indexOf(go), 1)
          reject(new DOMException('gave up', 'AbortError'))
        })
      })
    },
  } as unknown as LockManager
}

vi.stubGlobal('navigator', { locks: sharedLocks() })
afterAll(() => vi.unstubAllGlobals())

async function aWindow() {
  vi.resetModules()
  const running = await import('./running')
  const { EXPERIMENTAL_WORD, BASES_WORD, hiddenKinds } = await import('../../settings.svelte')
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, BASES_WORD]
  return running
}

const settle = () => new Promise((done) => setTimeout(done, 150))

describe("a base's automations, while two windows hold the base", () => {
  test('run in one window, and in the other once the first lets the base go', async () => {
    const first = await aWindow()
    const second = await aWindow()
    await first.readHeld('/s/Shared/Tasks.base')
    await settle()
    await second.readHeld('/s/Shared/Tasks.base')
    await settle()

    first.heard('Shared', 'Inbox/a.md', [])
    second.heard('Shared', 'Inbox/a.md', [])
    await settle()
    expect(ran).toEqual(['planned'])

    first.basesAre([])
    await settle()
    ran.length = 0
    first.heard('Shared', 'Inbox/b.md', [])
    second.heard('Shared', 'Inbox/b.md', [])
    await settle()
    expect(ran).toEqual(['planned'])
  })
})
