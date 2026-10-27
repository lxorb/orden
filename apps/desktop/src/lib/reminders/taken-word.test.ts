import { afterEach, expect, test, vi } from 'vitest'

/** The presses on a reminder are asked for with this launch's word: the bridge is in
 *  every frame of the webview, and a framed page that could take them would swallow
 *  a Done the reader pressed. See `frameWord` in mobile/bridge.ts. */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: false,
}))

const taken = vi.fn((said: string) => (said === 'the word' ? '[]' : ''))

vi.stubGlobal('window', globalThis)
vi.stubGlobal('__NIB_SYSTEM__', {
  insets: () => '{}',
  askForTheFrame: () => {
    ;(globalThis as unknown as { __nibFrame: (word: string) => void }).__nibFrame('the word')
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
