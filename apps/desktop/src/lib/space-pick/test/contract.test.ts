import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('addEventListener', () => undefined)
vi.stubGlobal('removeEventListener', () => undefined)
const { isNumber, ListTyping } = await import('../src/api')
function key(key: string, code = ''): KeyboardEvent {
  return {
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as KeyboardEvent
}
describe('picking from a list by typing', () => {
  test('a leading digit is a number, a letter is a name', () => {
    expect(isNumber('2')).toBe(true)
    expect(isNumber('b')).toBe(false)
  })
  test('goes at once to the only row its number reads', () => {
    const went: number[] = []
    const typing = new ListTyping(
      () => ['Home', 'Work', 'Notes'],
      (at) => went.push(at),
    )
    typing.press(key('2', 'Digit2'))
    expect(went).toEqual([1])
    typing.stop()
  })
  test('reads the best name for the letters typed, and Backspace takes one back', () => {
    const typing = new ListTyping(
      () => ['Home', 'Work', 'Notes'],
      () => undefined,
    )
    typing.press(key('w', 'KeyW'))
    expect(typing.typed).toBe('w')
    expect(typing.reading.best).toBe(1)
    typing.press(key('Backspace'))
    expect(typing.typed).toBe('')
    typing.stop()
  })
})
