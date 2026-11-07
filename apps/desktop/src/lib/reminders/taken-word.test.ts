import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: false,
}))

const taken = vi.fn((said: string) => (said === 'the word' ? '[]' : ''))

vi.stubGlobal('window', globalThis)
vi.stubGlobal('__ORDEN_SYSTEM__', {
  insets: () => '{}',
  askForTheFrame: () => {
    ;(globalThis as unknown as { __ordenFrame: (word: string) => void }).__ordenFrame('the word')
  },
  remindersTaken: taken,
})

afterEach(() => {
  taken.mockClear()
})

test('a reminder’s presses are taken with the word', async () => {
  const { taken: take } = await import('./platform')
  await take()

  expect(taken).toHaveBeenCalledWith('the word')
})
