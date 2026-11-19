import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Provider } from '../../../ai-providers/src/providers'

const CLAUDE: Provider = { id: 'claude-code', kind: 'claude-code', name: '', model: '' }
const CODEX: Provider = { id: 'codex', kind: 'codex', name: '', model: '' }

const world = vi.hoisted(() => ({ turns: 0 }))

vi.mock('../store/chat.svelte', () => ({
  chat: {
    threadOf: () => null,
    loadModels: (provider: { id: string }) =>
      provider.id === 'codex' ? new Promise(() => undefined) : Promise.resolve([]),
    adopt: () => undefined,
    turn: () => {
      world.turns += 1
      return new Promise(() => undefined)
    },
  },
}))

vi.mock('../commands/found', () => ({
  rootOfSpace: () => '/n',
  foundNamed: () => Promise.resolve(null),
  wordsOf: () => Promise.resolve(''),
}))

vi.mock('../../../workspace/src/api', () => ({
  workspace: { spaces: [{ id: 'Notes', root: '/n' }], activeSpace: { id: 'Notes' } },
}))

vi.mock('../../../ai-providers/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ai-providers/src/api')>()),
  ai: { providers: [CLAUDE, CODEX] },
  usable: () => true,
}))

const { runAgent } = await import('./run')
const { helpers } = await import('./helpers.svelte')

const ENDPOINT_PATIENCE = 30_000
const DELIVERY = 5000

function deadlineIn(ms: number): AbortSignal {
  const due = new AbortController()
  setTimeout(() => due.abort(), ms)
  return due.signal
}

beforeEach(() => {
  vi.useFakeTimers()
  world.turns = 0
})

afterEach(() => {
  for (const one of helpers.all) helpers.stop(one.id)
  helpers.all = []
  vi.useRealTimers()
})

describe('a helper asked for through the endpoint', () => {
  test('is said, with its id, before the endpoint stops waiting, while a provider’s models never come', async () => {
    const started = Date.now()
    const answering = runAgent(
      { prompt: 'Find the herons.' },
      { thread: null, mode: 'auto' },
      deadlineIn(ENDPOINT_PATIENCE - DELIVERY - 1000),
    ).then((said) => ({ said, after: Date.now() - started }))
    await vi.advanceTimersByTimeAsync(2 * ENDPOINT_PATIENCE)

    const { said, after } = await answering
    expect(after).toBeLessThan(ENDPOINT_PATIENCE - DELIVERY)
    expect(said).toMatchObject({ state: 'running', provider: 'claude-code' })
    expect(world.turns).toBe(1)
  })

  test('is not started once the deadline has passed while the models were being listed', async () => {
    const answering = runAgent({ prompt: 'Find the herons.' }, { thread: null, mode: 'auto' }, deadlineIn(5000))
    await vi.advanceTimersByTimeAsync(ENDPOINT_PATIENCE)

    expect(await answering).toMatchObject({ refused: expect.stringContaining('time to answer') })
    expect(world.turns).toBe(0)
    expect(helpers.all).toEqual([])
  })
})

describe('a long-lived deadline', () => {
  test('is left holding no listener once the models are listed and the helper said', async () => {
    const due = new AbortController()
    const signal = due.signal
    let held = 0
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = (...args: Parameters<typeof add>) => {
      held += 1
      add(...args)
    }
    signal.removeEventListener = (...args: Parameters<typeof remove>) => {
      held -= 1
      remove(...args)
    }

    const answering = runAgent({ prompt: 'Find the herons.' }, { thread: null, mode: 'auto' }, signal)
    await vi.advanceTimersByTimeAsync(2 * ENDPOINT_PATIENCE)
    await answering

    expect(held).toBe(0)
  })
})
