import { expect, test, vi } from 'vitest'
import { firstFrame, JOIN_SHELL, SETUP_SHELL } from './entry-mount'

vi.hoisted(() => {
  history.replaceState(null, '', '/join/0123456789abcdef0123')
})
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../../src/lib/start', () => ({ start: () => () => undefined }))
test("a shared note's link draws the join shell in the first frame, never the app under it (#2476)", async () => {
  const frame = await firstFrame()
  expect(frame.has(JOIN_SHELL)).toBe(true)
  expect(frame.has(SETUP_SHELL)).toBe(false)
  frame.end()
})
