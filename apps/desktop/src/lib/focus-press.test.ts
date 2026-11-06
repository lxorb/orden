import { describe, expect, test, vi } from 'vitest'

vi.mock('./workspace.svelte', () => ({ workspace: {} }))

const { keepFocus } = await import('./focus')

describe('a press that keeps the keyboard where it is', () => {
  const pressed = (pointerType?: string) => {
    const preventDefault = vi.fn()
    keepFocus({ preventDefault, ...(pointerType ? { pointerType } : {}) })
    return preventDefault.mock.calls.length > 0
  }

  test('holds back the mouse and the pen', () => {
    expect(pressed('mouse')).toBe(true)
    expect(pressed('pen')).toBe(true)
  })

  test('and the mousedown that follows any press', () => {
    expect(pressed()).toBe(true)
  })

  test('but never a finger, whose click would go with it', () => {
    expect(pressed('touch')).toBe(false)
  })
})
