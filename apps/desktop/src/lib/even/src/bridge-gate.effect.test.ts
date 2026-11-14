import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

const { bridge } = await import('./bridge.svelte')
const { EXPERIMENTAL_WORD, GLASSES_WORD, glassesOn, hiddenKinds } =
  await import('../../settings.svelte')

describe('the plugin and the glasses (#2027)', () => {
  test('connects only while Glasses is on, and lets go when it goes off', () => {
    hiddenKinds.hidden = [EXPERIMENTAL_WORD]
    const stopped = vi.fn()
    const start = vi.spyOn(bridge, 'start').mockImplementation(() => stopped)

    const end = bridge.startWhile(glassesOn)
    flushSync()
    expect(start).not.toHaveBeenCalled()

    hiddenKinds.hidden = [EXPERIMENTAL_WORD, GLASSES_WORD]
    flushSync()
    expect(start).toHaveBeenCalledTimes(1)

    hiddenKinds.hidden = [GLASSES_WORD]
    flushSync()
    expect(stopped).toHaveBeenCalledTimes(1)

    end()
    hiddenKinds.hidden = [EXPERIMENTAL_WORD, GLASSES_WORD]
    flushSync()
    expect(start).toHaveBeenCalledTimes(1)
    start.mockRestore()
  })
})
