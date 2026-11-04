import { afterEach, describe, expect, test } from 'vitest'
import { overlays } from '../overlays'
import { hearPressesAway, pressedAway } from './pressed-away'

/** #1110: a press past a list's selection lets it go; one on a row, on the bar that acts
 *  on the selection, or inside a layer over the list does not. */

function page() {
  document.body.innerHTML = `
    <div class="list"><div role="option" class="row"><button class="words">Call</button></div>
      <div class="room"></div></div>
    <div class="bar"><button class="go">Schedule</button></div>
    <div role="option" class="elsewhere">Another list's row</div>
    <p class="away">Another pane</p>`
  const at = (one: string) => document.querySelector<HTMLElement>(one)!
  return { at, list: at('.list'), bar: at('.bar') }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a press past the selection', () => {
  test('outside the rows and the bar lets it go', () => {
    const { at, list, bar } = page()
    expect(pressedAway(at('.away'), list, bar)).toBe(true)
    expect(pressedAway(at('.room'), list, bar)).toBe(true)
    expect(pressedAway(at('.elsewhere'), list, bar)).toBe(true)
  })

  test('on a row of the list, or on its bar, is theirs', () => {
    const { at, list, bar } = page()
    expect(pressedAway(at('.row'), list, bar)).toBe(false)
    expect(pressedAway(at('.words'), list, bar)).toBe(false)
    expect(pressedAway(at('.go'), list, bar)).toBe(false)
  })

  test('while a layer is over the list is the layer’s', () => {
    const { at, list, bar } = page()
    const close = overlays.show(() => undefined, undefined, null)
    try {
      expect(pressedAway(at('.away'), list, bar)).toBe(false)
    } finally {
      close()
    }
  })

  test('is heard on the way down, until the teardown', () => {
    const { at, list, bar } = page()
    let told = 0
    const stop = hearPressesAway(
      () => list,
      () => bar,
      () => told++,
    )
    const press = (one: string) =>
      at(one).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    press('.away')
    press('.row')
    expect(told).toBe(1)
    stop()
    press('.away')
    expect(told).toBe(1)
  })
})
