import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'

vi.mock('../../../platform/src/tauri', () => ({
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.reject(new Error('not here')),
}))

const { deleteThread, listThreads, newThread, writeThread } = await import('./threads')

test('threads written at once in one space are all in its list', async () => {
  const made = Array.from({ length: 12 }, (_, at) => {
    const thread = newThread('space-1', 'anthropic', 'claude-opus-5-5', 'high', 'full')
    thread.title = `Chat ${String(at)}`
    return thread
  })

  await Promise.all(made.map((one) => writeThread(one)))

  const listed = (await listThreads('space-1')).map((one) => one.id).sort()
  expect(listed).toEqual(made.map((one) => one.id).sort())

  const [gone, ...rest] = made
  if (!gone) throw new Error('no thread')
  await Promise.all([deleteThread('space-1', gone.id), ...rest.map((one) => writeThread(one))])
  expect((await listThreads('space-1')).map((one) => one.id).sort()).toEqual(
    rest.map((one) => one.id).sort(),
  )
})
