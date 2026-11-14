import { afterEach, describe, expect, test, vi } from 'vitest'
import { frameOf } from './frame'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a frame of an application picture', () => {
  test('a stream that sends no frame answers nothing in time, though its play never settles', async () => {
    vi.useFakeTimers()
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null as unknown,
      readyState: 0,
      play: () => new Promise<void>(() => undefined),
      pause: vi.fn(),
      addEventListener: () => undefined,
    }
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 })
    vi.stubGlobal('document', { createElement: () => video })

    const going = frameOf({} as MediaStream)
    await vi.advanceTimersByTimeAsync(3000)
    await expect(going).resolves.toBeNull()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })
})
