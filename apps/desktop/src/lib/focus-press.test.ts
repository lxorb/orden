import { describe, expect, test, vi } from 'vitest'

// The region half of the module reaches for the workspace, which none of this is about.
vi.mock('./workspace.svelte', () => ({ workspace: {} }))

const { keepFocus } = await import('./focus')

/** #384: a pointerdown held back is, to WebKit, a tap called off - no click follows - so
 *  a finger's is left alone and the mousedown after it is held back instead. */
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
