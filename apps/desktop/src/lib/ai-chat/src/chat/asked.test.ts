import { describe, expect, test, vi } from 'vitest'

let heard: ((event: { payload: unknown }) => void) | null = null
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_: string, on: (event: { payload: unknown }) => void) => {
    heard = on
    return Promise.resolve(() => (heard = null))
  },
}))
vi.mock('../../../platform/src/api', async (actual) => ({
  ...(await actual<typeof import('../../../platform/src/api')>()),
  isDesktop: true,
}))
const { crateAnswers } = await import('./approvals')

describe('a question the crate asks', () => {
  test('names the thread that raised it, and no thread where the crate names none', async () => {
    const asked: unknown[] = []
    await crateAnswers.asked((one) => asked.push(one))
    const approval = { id: 'q1', agent: 'orden-cc', verb: 'read_note', category: 'writing' }
    heard?.({ payload: { kind: 'asked', approval: { ...approval, thread: 'thread-b' } } })
    heard?.({ payload: { kind: 'asked', approval: { ...approval, id: 'q2', thread: '' } } })
    heard?.({ payload: { kind: 'asked', approval: { ...approval, id: 'q3' } } })
    expect(asked).toEqual([
      { ...approval, thread: 'thread-b' },
      { ...approval, id: 'q2' },
      { ...approval, id: 'q3' },
    ])
  })
})
