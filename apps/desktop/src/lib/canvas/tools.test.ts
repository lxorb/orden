import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The pens are kept in the browser's storage, which the modules read as they load. */
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
})

const { HOLD, tools } = await import('./tools.svelte')

const key = (timeStamp: number, repeat = false) => ({ code: 'KeyQ', timeStamp, repeat })

describe("the lasso's key (#349)", () => {
  beforeEach(() => {
    tools.choose('draw')
  })

  test('tapped, puts the lasso in hand and leaves it there', () => {
    tools.pressed('lasso', key(1000))
    tools.released(key(1000 + HOLD / 2))
    expect(tools.which).toBe('lasso')
  })

  test('held, is the lasso only until it comes up, and then the tool before it', () => {
    tools.pressed('lasso', key(1000))
    expect(tools.which).toBe('lasso')
    tools.pressed('lasso', key(1030, true))
    tools.pressed('lasso', key(1060, true))
    tools.released(key(1000 + HOLD + 50))
    expect(tools.which).toBe('draw')
  })

  test('used while it is down is held, however short the press', () => {
    tools.pressed('lasso', key(1000))
    tools.used()
    tools.released(key(1050))
    expect(tools.which).toBe('draw')
  })

  test('let go of after another tool was chosen leaves that tool', () => {
    tools.pressed('lasso', key(1000))
    tools.choose('erase')
    tools.released(key(2000))
    expect(tools.which).toBe('erase')
  })

  test('another key let go of changes nothing', () => {
    tools.pressed('lasso', key(1000))
    tools.released({ code: 'KeyV', timeStamp: 2000 })
    expect(tools.which).toBe('lasso')
  })

  test("another tool's key is a tool chosen, held or not", () => {
    tools.pressed('erase', { code: 'KeyE', timeStamp: 1000 })
    tools.released({ code: 'KeyE', timeStamp: 3000 })
    expect(tools.which).toBe('erase')
  })
})
