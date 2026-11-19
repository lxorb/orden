import { describe, expect, test } from 'vitest'
import { tabsAway, turnOf } from './swipe'

describe('a swipe across the bar', () => {
  test('to the left is the next tab, to the right the one before', () => {
    expect(turnOf(-80, 4)).toBe(1)
    expect(turnOf(80, -4)).toBe(-1)
  })
  test('too short, or more down than across, turns nothing', () => {
    expect(turnOf(-20, 0)).toBe(0)
    expect(turnOf(-80, 60)).toBe(0)
    expect(turnOf(0, 0)).toBe(0)
  })
})
describe('a card flung aside', () => {
  test('goes once it is past a third of its width, either way', () => {
    expect(tabsAway(-60, 160)).toBe(true)
    expect(tabsAway(60, 160)).toBe(true)
    expect(tabsAway(40, 160)).toBe(false)
  })
  test('a card with no width never goes', () => {
    expect(tabsAway(60, 0)).toBe(false)
  })
})
