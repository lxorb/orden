import { describe, expect, test } from 'vitest'
import { type Resizable, WindowState } from './window-state.svelte'

class FakeWindow implements Resizable {
  maximized = false
  fullscreen = false
  listeners = 0
  asked = 0

  private readonly told = new Set<() => void>()
  stubborn = false

  isMaximized(): Promise<boolean> {
    this.asked++
    return Promise.resolve(this.maximized)
  }

  isFullscreen(): Promise<boolean> {
    return Promise.resolve(this.fullscreen)
  }

  toggleMaximize(): Promise<void> {
    if (!this.stubborn) this.resize(!this.maximized)
    return Promise.resolve()
  }

  onResized(handler: () => void): Promise<() => void> {
    this.told.add(handler)
    this.listeners++

    return Promise.resolve(() => {
      this.told.delete(handler)
      this.listeners--
    })
  }

  resize(maximized: boolean, fullscreen = this.fullscreen) {
    this.maximized = maximized
    this.fullscreen = fullscreen
    for (const handler of this.told) handler()
  }
}

const settled = () => new Promise((done) => setTimeout(done, 0))

describe('whether the window is maximised', () => {
  test('starts from what the window says, not from a guess', async () => {
    const window = new FakeWindow()
    window.maximized = true
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    expect(state.maximized).toBe(true)
    stop()
  })

  test('follows a window maximised by something other than the button', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(state.maximized).toBe(false)

    window.resize(true)
    await settled()

    expect(state.maximized).toBe(true)
    stop()
  })

  test('follows a maximised window dragged off the top of the screen', async () => {
    const window = new FakeWindow()
    window.maximized = true
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    window.resize(false)
    await settled()

    expect(state.maximized).toBe(false)
    stop()
  })

  test('the button says what happened rather than what it asked for', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    window.stubborn = true
    await state.toggle(window)

    expect(state.maximized).toBe(false)
    stop()
  })

  test('the button and the window agree when the toggle works', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    await state.toggle(window)
    expect(state.maximized).toBe(true)

    await state.toggle(window)
    expect(state.maximized).toBe(false)

    stop()
  })

  test('stops listening when the bar goes', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(window.listeners).toBe(1)

    stop()

    expect(window.listeners).toBe(0)

    window.resize(true)
    await settled()
    expect(state.maximized).toBe(false)
  })

  test('a bar that goes before the window arrives leaves no listener behind', async () => {
    const window = new FakeWindow()
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    stop()
    await settled()

    expect(window.listeners).toBe(0)
    expect(state.maximized).toBe(false)
  })

  test('asks the window only when its size changed', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    const before = window.asked
    await settled()
    expect(window.asked).toBe(before)

    window.resize(true)
    await settled()
    expect(window.asked).toBe(before + 1)

    stop()
  })
})

describe('whether the window is full screen', () => {
  test('follows the window in and out of it', async () => {
    const window = new FakeWindow()
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(state.fullscreen).toBe(false)

    window.resize(false, true)
    await settled()
    expect(state.fullscreen).toBe(true)

    window.resize(false, false)
    await settled()
    expect(state.fullscreen).toBe(false)
    stop()
  })
})
