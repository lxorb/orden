import { afterEach, expect, test, vi } from 'vitest'

/** A reminder's presses asked for while the activity does not say the word, as on a
 *  cold start before it has a page (B456). The ask goes on with no word rather than
 *  waiting for one that may never come, and a word said late is used next time. */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: false,
}))

const taken = vi.fn((said: string) => (said === 'the word' ? '[]' : ''))

vi.stubGlobal('window', globalThis)
vi.stubGlobal('__NIB_SYSTEM__', {
  insets: () => '{}',
  askForTheFrame: () => undefined,
  remindersTaken: taken,
})

afterEach(() => {
  vi.useRealTimers()
})

test('a reminder’s presses are asked for without a word that never comes', async () => {
  vi.useFakeTimers()
  const { taken: take } = await import('./platform')
  const asked = take()
  await vi.advanceTimersByTimeAsync(2000)

  expect(await asked).toEqual([])
  expect(taken).toHaveBeenCalledWith('')

  // The activity says it after all; the next ask carries it.
  ;(globalThis as unknown as { __nibFrame: (word: string) => void }).__nibFrame('the word')
  await take()
  expect(taken).toHaveBeenLastCalledWith('the word')
})
