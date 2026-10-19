import { afterEach, describe, expect, test, vi } from 'vitest'
import { spendClick } from './spent-click'

/** The window's own listeners, heard as the window would dispatch them. */
const heard = new Map<string, Set<(event: Event) => void>>()

vi.stubGlobal('window', {
  addEventListener: (type: string, one: (event: Event) => void) => {
    const all = heard.get(type) ?? new Set()
    all.add(one)
    heard.set(type, all)
  },
  removeEventListener: (type: string, one: (event: Event) => void) => heard.get(type)?.delete(one),
})

/** An event the window dispatches, and whether a listener spent it. */
function dispatch(type: string) {
  const event = {
    spent: false,
    preventDefault() {
      this.spent = true
    },
    stopImmediatePropagation() {
      this.spent = true
    },
  }
  for (const one of [...(heard.get(type) ?? [])]) one(event as unknown as Event)
  return event.spent
}

afterEach(() => {
  dispatch('pointerdown')
  vi.useRealTimers()
})

describe('a catch that takes a tap (#411)', () => {
  test('spends the click the tap goes on to make, and only that one', () => {
    spendClick({ pointerType: 'touch' })
    expect(dispatch('click')).toBe(true)
    expect(dispatch('click')).toBe(false)
  })

  test('leaves a mouse s click alone, which the catch took already', () => {
    spendClick({ pointerType: 'mouse' })
    expect(dispatch('click')).toBe(false)
  })

  test('lets go at the next press, or when no click came', () => {
    spendClick({ pointerType: 'pen' })
    dispatch('pointerdown')
    expect(dispatch('click')).toBe(false)

    vi.useFakeTimers()
    spendClick({ pointerType: 'touch' })
    vi.advanceTimersByTime(1000)
    expect(dispatch('click')).toBe(false)
  })
})
