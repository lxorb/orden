import { expect, test, vi } from 'vitest'
import { firstFrame, JOIN_SHELL, SETUP_SHELL } from './entry-mount'

vi.hoisted(() => {
  localStorage.setItem(
    'orden:setup',
    JSON.stringify({ step: 'welcome', trail: ['welcome'], answers: {}, signedIn: false }),
  )
})
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../../src/lib/start', () => ({ start: () => () => undefined }))
test('a setup left part way draws its shell in the first frame, never the app under it (#2476)', async () => {
  const frame = await firstFrame()
  expect(frame.has(SETUP_SHELL)).toBe(true)
  expect(frame.has(JOIN_SHELL)).toBe(false)
  frame.end()
})
