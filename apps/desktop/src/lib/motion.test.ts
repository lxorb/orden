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

/** One set of numbers for every layer the app puts up, and the reason the guard in
 *  test/motion.test.ts lets a component spell a duration this way: both of these
 *  are `dur` behind a name. */
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

  /** Read at the moment the transition starts rather than when the module loaded,
   *  the way `dur` is: a reader who turns the setting on mid-session is answered by
   *  the next thing that moves. */
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
