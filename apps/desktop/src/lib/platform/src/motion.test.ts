import { afterEach, describe, expect, test, vi } from 'vitest'

async function motion(matches: boolean | null) {
  vi.resetModules()

  if (matches === null) vi.stubGlobal('window', {})
  else vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches, query }) })

  return import('./motion')
}

await motion(false)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('how long something moves for', () => {
  test('is what was asked for where nothing says otherwise', async () => {
    const { dur, stillness } = await motion(false)

    expect(stillness()).toBe(false)
    expect(dur(130)).toBe(130)
    expect(dur(220)).toBe(220)
  })

  test('is nothing at all for a reader who asked for less movement', async () => {
    const { dur, stillness } = await motion(true)

    expect(stillness()).toBe(true)
    expect(dur(130)).toBe(0)
    expect(dur(220)).toBe(0)
  })

  test('holds for a duration nobody wrote down', async () => {
    const { dur } = await motion(true)
    expect(dur(Math.round(200 + 180 * 0.4))).toBe(0)
  })

  test('is what was asked for where there is nothing to ask', async () => {
    const { dur, stillness } = await motion(null)

    expect(stillness()).toBe(false)
    expect(dur(190)).toBe(190)
  })

  test('asks for the setting by its own name', async () => {
    const asked: string[] = []
    vi.resetModules()
    vi.stubGlobal('window', {
      matchMedia: (query: string) => {
        asked.push(query)
        return { matches: false }
      },
    })

    await import('./motion')
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)'])
  })
})

describe('how a layer arrives', () => {
  test('is the same two numbers wherever it is asked for', async () => {
    const { LAYER } = await motion(false)

    expect(LAYER.fade).toBe(130)
    expect(LAYER.rise).toBe(190)
    expect(LAYER.start).toBe(0.97)
  })

  test('and is nothing at all for a reader who asked for less movement', async () => {
    const { LAYER } = await motion(true)

    expect(LAYER.fade).toBe(0)
    expect(LAYER.rise).toBe(0)
  })

  test('and is read afresh each time it is asked', async () => {
    let asked = false
    vi.resetModules()
    vi.stubGlobal('window', {
      matchMedia: () => ({
        get matches() {
          return asked
        },
      }),
    })

    const { LAYER } = await import('./motion')
    expect(LAYER.rise).toBe(190)

    asked = true
    expect(LAYER.rise).toBe(0)
  })
})

describe('a transition that does not move', () => {
  const node = {} as Element
  const style = { opacity: '1', transform: 'none' }

  test('reads no style off its element, so the page is not laid out for it', async () => {
    const { fade, fly, scale, slide } = await motion(true)
    const read = vi.fn(() => style)
    vi.stubGlobal('getComputedStyle', read)

    for (const move of [fade, fly, scale, slide]) {
      expect(move(node, { duration: 0 })).toEqual({ delay: 0, duration: 0 })
    }
    expect(fly(node, { duration: 0, delay: 40 })).toEqual({ delay: 40, duration: 0 })
    expect(read).not.toHaveBeenCalled()
  })

  test('while one that moves reads where it starts from', async () => {
    const { fly } = await motion(false)
    const read = vi.fn(() => style)
    vi.stubGlobal('getComputedStyle', read)

    expect(fly(node, { duration: 120, y: 8 }).duration).toBe(120)
    expect(fly(node).duration).toBe(400)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
