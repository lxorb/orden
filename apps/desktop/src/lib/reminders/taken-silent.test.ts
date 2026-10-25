import { afterEach, expect, test, vi } from 'vitest'

/** The reminders and the phone's activity, while it does not say the word, as on a
 *  cold start before it has a page (B456). Nothing waits for a word that may never
 *  come, and nothing dropped for the lack of one is taken for done. */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: false,
}))

const taken = vi.fn((said: string) => (said === 'the word' ? '[]' : ''))
const alarms = vi.fn()

vi.stubGlobal('window', globalThis)
vi.stubGlobal('__NIB_SYSTEM__', {
  insets: () => '{}',
  askForTheFrame: () => undefined,
  remindersTaken: taken,
  reminders: alarms,
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

test('a plan the alarms could not take is not said to be handed', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  alarms.mockClear()
  const { hand } = await import('./platform')
  const { NoWord } = await import('../mobile/bridge')

  const handing = hand([])
  const failed = expect(handing).rejects.toBeInstanceOf(NoWord)
  await vi.advanceTimersByTimeAsync(2000)
  await failed
  expect(alarms).not.toHaveBeenCalled()
})
