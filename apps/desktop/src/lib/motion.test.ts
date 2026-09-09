import { afterEach, describe, expect, test, vi } from 'vitest'

/** The module reads `matchMedia` once, when it is imported, so each case is a
 *  fresh import over a fresh stand-in. Imported once first, outside any test, so
 *  no single test is charged for compiling it; see docs/conventions.md. */
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

  /** The one the drawer asks with, worked out from how far it has left to go. */
  test('holds for a duration nobody wrote down', async () => {
    const { dur } = await motion(true)
    expect(dur(Math.round(200 + 180 * 0.4))).toBe(0)
  })

  /** Imported where there is no window: a test, and prerendering later on. */
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
