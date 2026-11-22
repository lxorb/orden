import { expect, test, vi } from 'vitest'
import { firstFrame, JOIN_SHELL, SETUP_SHELL } from './entry-mount'

vi.hoisted(() => {
  localStorage.setItem('orden:setup', JSON.stringify('done'))
})
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../../src/lib/start', () => ({ start: () => () => undefined }))
test('a plain launch draws the app itself in the first frame, with no entry shell over it (#2476)', async () => {
  const frame = await firstFrame()
  expect(frame.has(JOIN_SHELL)).toBe(false)
  expect(frame.has(SETUP_SHELL)).toBe(false)
  expect(document.querySelector('#app, main, [data-pane], aside')).not.toBeNull()
  frame.end()
})
