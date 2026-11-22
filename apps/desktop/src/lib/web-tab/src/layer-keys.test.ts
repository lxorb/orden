// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'

const taken = vi.fn<() => void>()
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  takeKeyboard: () => {
    taken()
    return Promise.resolve()
  },
}))
const { overlays } = await import('../../ui-kit/src/api')
const { keysFollowLayers } = await import('./layer-keys')

afterEach(() => {
  taken.mockClear()
  vi.restoreAllMocks()
})
test('a layer opened while a page holds the keyboard takes it for the app, once', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const stopOne = keysFollowLayers()
  const stopTwo = keysFollowLayers()
  const shut = overlays.show(() => undefined)
  expect(taken).toHaveBeenCalledTimes(1)
  shut()
  expect(taken).toHaveBeenCalledTimes(1)
  stopOne()
  stopTwo()
})
test('a layer opened while the app has the keyboard leaves it where it is', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const stop = keysFollowLayers()
  const shut = overlays.show(() => undefined)
  shut()
  stop()
  expect(taken).not.toHaveBeenCalled()
})
test('a peek is no layer that wants typing', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const stop = keysFollowLayers()
  const shut = overlays.peek(() => undefined)
  shut()
  stop()
  expect(taken).not.toHaveBeenCalled()
})
