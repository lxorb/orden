import { describe, expect, test } from 'vitest'
import { listenSwipes, swipeChoice, swiping } from '../src/api'
import { taken } from '../src/edge'
import { distance, MOST } from '../src/gesture'

describe('the module stands on its own', () => {
  test('the api loads with nothing listening and no arrow shown', () => {
    expect(typeof listenSwipes).toBe('function')
    expect(typeof swiping).toBe('object')
    expect(typeof swipeChoice.on).toBe('boolean')
  })
})

describe('when a sideways swipe goes back or forward', () => {
  test('only once nothing under the finger can still scroll that way', () => {
    const scroller = { left: 0, range: 100, rtl: false, keeps: false }
    expect(taken([scroller])).toEqual({ left: false, right: true })
    expect(taken([{ ...scroller, left: 100 }])).toEqual({ left: true, right: false })
    expect(taken([{ ...scroller, left: -100, rtl: true }])).toEqual({ left: false, right: true })
    expect(taken([{ ...scroller, left: 50, keeps: true }])).toEqual({ left: true, right: true })
  })

  test('after a distance that grows with the window and never past its cap', () => {
    expect(distance('touch', 400, 800)).toBeLessThan(distance('touch', 1600, 1000))
    expect(distance('touchpad', 100_000, 100)).toBe(MOST)
  })
})
