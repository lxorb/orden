import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { linkScroll, type ScrollEnd } from './linked-scroll'

class End implements ScrollEnd {
  private at = 0
  private listeners: (() => void)[] = []

  readonly shown: number[] = []

  top(): number {
    return this.at
  }

  show(position: number) {
    this.shown.push(position)
    this.at = position
    for (const run of this.listeners) run()
  }

  onScroll(run: () => void): () => void {
    this.listeners.push(run)
    return () => {
      this.listeners = this.listeners.filter((one) => one !== run)
    }
  }

  scrollTo(position: number) {
    this.at = position
    for (const run of this.listeners) run()
  }
}

describe('two panes scrolling together', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('puts the line at the top of one at the top of the other', () => {
    const left = new End()
    const right = new End()
    linkScroll(left, right)

    left.scrollTo(420)

    expect(right.shown).toEqual([420])
    expect(right.top()).toBe(420)
  })

  test('does not carry the echo back', () => {
    const left = new End()
    const right = new End()
    linkScroll(left, right)

    left.scrollTo(100)

    expect(left.shown).toEqual([])
  })

  test('lets the other pane lead once the first is still', () => {
    const left = new End()
    const right = new End()
    linkScroll(left, right)

    left.scrollTo(100)
    vi.advanceTimersByTime(200)
    right.scrollTo(300)

    expect(left.shown).toEqual([300])
  })

  test('keeps the one that started leading while it is moving', () => {
    const left = new End()
    const right = new End()
    linkScroll(left, right)

    left.scrollTo(100)
    left.scrollTo(200)
    left.scrollTo(300)

    expect(right.shown).toEqual([100, 200, 300])
    expect(left.shown).toEqual([])
  })

  test('stops when the link is taken off', () => {
    const left = new End()
    const right = new End()
    const stop = linkScroll(left, right)

    stop()
    left.scrollTo(50)

    expect(right.shown).toEqual([])
  })
})
