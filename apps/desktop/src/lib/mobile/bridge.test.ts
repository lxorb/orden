import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** This launch's word, when the activity is slow to say it or never does (B456). The
 *  answer goes through the UI thread, which on a cold start can be busy for seconds,
 *  and it never comes while the activity has no page yet. A word given up on was kept
 *  for the whole launch, and every call that wants it then did nothing: the share
 *  that started the app, the widget rows, a reminder's Done. A wait with no end is no
 *  better, since every one of those callers would then never go on. */

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
    askForTheFrame: () => {
      asked++
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a caller with no answer goes on with no word, within the wait', async () => {
  const { frameWord } = await import('./bridge')
  let got: string | undefined
  void frameWord().then((word) => (got = word))

  await vi.advanceTimersByTimeAsync(2000)
  expect(got).toBe('')
})

test('no word is not kept: the next caller asks again', async () => {
  const { frameWord } = await import('./bridge')
  void frameWord()
  await vi.advanceTimersByTimeAsync(2000)

  void frameWord()
  expect(asked).toBe(2)
})

test('a word said after the wait was given up on is the word from then on', async () => {
  const { frameWord } = await import('./bridge')
  const first = frameWord()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await first).toBe('')

  say('the word')

  expect(await frameWord()).toBe('the word')
  expect(asked).toBe(1)
})

test('two callers at once are one question', async () => {
  const { frameWord } = await import('./bridge')
  const one = frameWord()
  const two = frameWord()
  say('the word')

  expect(await one).toBe('the word')
  expect(await two).toBe('the word')
  expect(asked).toBe(1)
})

test('nothing to ask is no word, at once', async () => {
  vi.stubGlobal('__NIB_SYSTEM__', undefined)
  const { frameWord } = await import('./bridge')

  expect(await frameWord()).toBe('')
})

test('an ask that throws is no word, and is asked again next time', async () => {
  let throwing = true
  vi.stubGlobal('__NIB_SYSTEM__', {
    insets: () => '{}',
    askForTheFrame: () => {
      asked++
      if (throwing) throw new Error('gone')
    },
  })
  const { frameWord } = await import('./bridge')

  expect(await frameWord()).toBe('')
  throwing = false
  void frameWord()
  expect(asked).toBe(2)
})

test('an empty answer is no answer: the question still waits for the word', async () => {
  const { frameWord } = await import('./bridge')
  const first = frameWord()
  say('')
  void frameWord()
  expect(asked).toBe(1)

  say('the word')
  expect(await first).toBe('the word')
})

test('the word said late is heard by whoever waits for it', async () => {
  const { frameWord, wordSaid } = await import('./bridge')
  let heard: string | undefined
  void wordSaid().then((word) => (heard = word))

  void frameWord()
  await vi.advanceTimersByTimeAsync(5000)
  expect(heard).toBeUndefined()

  say('the word')
  await vi.advanceTimersByTimeAsync(0)
  expect(heard).toBe('the word')
})
