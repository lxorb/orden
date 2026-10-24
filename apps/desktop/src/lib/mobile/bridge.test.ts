import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** This launch's word, when the activity is slow to say it (B456). The answer goes
 *  through the UI thread, which on a cold start can be busy for seconds; a word given
 *  up on there was kept for the whole launch, and every call that wants it then did
 *  nothing: the share that started the app, the widget rows, a reminder's Done. */

let asked = 0
const say = (word: string): void => {
  ;(globalThis as unknown as { __nibFrame: (word: string) => void }).__nibFrame(word)
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  asked = 0
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('__NIB_SYSTEM__', {
    insets: () => '{}',
    askForTheFrame: () => void asked++,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a word the activity says late is still the word', async () => {
  const { frameWord } = await import('./bridge')
  const first = frameWord()

  await vi.advanceTimersByTimeAsync(5000)
  say('the word')

  expect(await first).toBe('the word')
  expect(await frameWord()).toBe('the word')
})

test('the activity is asked again while it has not answered', async () => {
  const { frameWord } = await import('./bridge')
  void frameWord()

  await vi.advanceTimersByTimeAsync(5000)
  expect(asked).toBeGreaterThan(1)

  const before = asked
  say('the word')
  await vi.advanceTimersByTimeAsync(5000)
  expect(asked).toBe(before)
})

test('nothing to ask is no word, at once', async () => {
  vi.stubGlobal('__NIB_SYSTEM__', undefined)
  const { frameWord } = await import('./bridge')

  expect(await frameWord()).toBe('')
})
