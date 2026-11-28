import { describe, expect, test } from 'vitest'
import { MOST_SCREENS, type Screen, Screens } from './back-screens.svelte'

const at = (tab: string, step = 0): Screen => ({ tab, at: step })
function went(...shown: Screen[]): Screens {
  const screens = new Screens()
  for (const one of shown) screens.seen(one)
  return screens
}
function returned(screens: Screens, lands: (to: Screen) => Screen = (to) => to): Screen | null {
  const to = screens.back()
  if (to) screens.seen(lands(to))
  return to
}
describe('the screens a reader went through on a phone, for Back to go back through', () => {
  test('are each kept as they are left, a tab or a step inside a tab alike', () => {
    const screens = went(at('a'), at('b'), at('b', 1), at('c'))
    expect(screens.depth).toBe(3)
    expect([returned(screens), returned(screens), returned(screens)]).toEqual([at('b', 1), at('b'), at('a')])
    expect(screens.depth).toBe(0)
    expect(screens.back()).toBe(null)
  })
  test('are not added to by going back, so two tabs never turn into a loop', () => {
    const screens = went(at('a'), at('b'))
    expect(returned(screens)).toEqual(at('a'))
    expect(screens.depth).toBe(0)
    screens.seen(at('b'))
    expect(screens.depth).toBe(1)
    expect(returned(screens)).toEqual(at('a'))
    expect(screens.depth).toBe(0)
  })
  test('take the tab gone back to at whatever step it is on now', () => {
    const screens = went(at('a', 2), at('b'))
    expect(returned(screens, () => at('a', 5))).toEqual(at('a', 2))
    expect(screens.depth).toBe(0)
  })
  test('skip a tab closed since, and say nothing is left once all of them are', () => {
    const screens = went(at('a'), at('b'), at('c'))
    screens.keep(['a', 'c'])
    expect(screens.depth).toBe(1)
    expect(returned(screens)).toEqual(at('a'))
    const closed = went(at('a'), at('b'))
    closed.keep(['b'])
    expect([closed.depth, closed.back()]).toEqual([0, null])
  })
  test('never hold the same screen twice in a row, nor the one in front', () => {
    const twice = went(at('a'), at('b'), at('a'), at('c'))
    twice.keep(['a', 'c'])
    expect(twice.depth).toBe(1)
    expect(returned(twice)).toEqual(at('a'))
    const front = went(at('a'), at('b'))
    front.seen(at('a'))
    front.keep(['a'])
    expect(front.depth).toBe(0)
  })
  test('go there and back again: a screen left twice is gone back to twice', () => {
    const screens = went(at('a'), at('b'), at('a'))
    expect(screens.depth).toBe(2)
    expect([returned(screens), returned(screens)]).toEqual([at('b'), at('a')])
    expect(screens.depth).toBe(0)
  })
  test('hold the latest fifty and forget the oldest', () => {
    const screens = went(...Array.from({ length: MOST_SCREENS + 20 }, (_, step) => at(`t${String(step)}`)))
    expect(MOST_SCREENS).toBe(50)
    expect(screens.depth).toBe(MOST_SCREENS)
    let last: Screen | null = null
    for (let to = screens.back(); to; to = screens.back()) last = to
    expect(last).toEqual(at('t19'))
  })
  test('count a move made after a Back that never landed as a move of its own', () => {
    const screens = went(at('a'), at('b'))
    expect(screens.back()).toEqual(at('a'))
    screens.seen(at('c'))
    expect(screens.depth).toBe(1)
    expect(returned(screens)).toEqual(at('b'))
  })
  test('start from nothing shown, and from nothing again once the last tab is closed', () => {
    const screens = new Screens()
    screens.seen(null)
    screens.seen(at('a'))
    expect(screens.depth).toBe(0)
    screens.seen(null)
    expect(screens.depth).toBe(1)
  })
})
