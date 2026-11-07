import { beforeEach, describe, expect, test, vi } from 'vitest'

class FakeElement {
  isContentEditable = false
  readonly worn = new Set<string>()
  readonly classList = {
    add: (name: string) => this.worn.add(name),
    remove: (name: string) => this.worn.delete(name),
  }
}
class FakeInput extends FakeElement {
  type = 'text'
  readOnly = false
  disabled = false
}
class FakeTextArea extends FakeElement {
  readOnly = false
  disabled = false
}
vi.stubGlobal('Element', FakeElement)
vi.stubGlobal('HTMLElement', FakeElement)
vi.stubGlobal('HTMLInputElement', FakeInput)
vi.stubGlobal('HTMLTextAreaElement', FakeTextArea)

const { HIDDEN, TypingPointer, takesWords, writes } = await import('./typing-pointer')

const note = Object.assign(new FakeElement(), { isContentEditable: true })

interface Key {
  key: string
  target?: unknown
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  altGraph?: boolean
}

function key({ key, target = note, altGraph = false, ...held }: Key): KeyboardEvent {
  const event = {
    type: 'keydown',
    key,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...held,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
  }
  return event as unknown as KeyboardEvent
}

function pointer(
  type: string,
  fields: Partial<PointerEvent> = {},
  over: FakeElement = under,
): PointerEvent {
  return {
    type,
    pointerType: 'mouse',
    movementX: 0,
    movementY: 0,
    clientX: 0,
    clientY: 0,
    composedPath: () => [over],
    ...fields,
  } as unknown as PointerEvent
}

let under = new FakeElement()
const listened = new Set<string>()
const listening = {
  addEventListener: (type: string) => listened.add(type),
  removeEventListener: (type: string) => listened.delete(type),
}

let typing: InstanceType<typeof TypingPointer>

const hidden = () => under.worn.has(HIDDEN)

beforeEach(() => {
  under = new FakeElement()
  listened.clear()
  typing = new TypingPointer(listening, false)
  typing.handleEvent(pointer('pointerover'))
})

describe('a key that writes', () => {
  test('a character, Enter, Backspace, Delete, a composition and a dead key', () => {
    for (const one of [
      'a',
      'Z',
      ' ',
      'é',
      '😀',
      'Enter',
      'Backspace',
      'Delete',
      'Process',
      'Dead',
    ]) {
      expect(writes(key({ key: one }), false), one).toBe(true)
    }
  })

  test('not a key that moves or commands', () => {
    for (const one of [
      'ArrowLeft',
      'Home',
      'PageDown',
      'Tab',
      'Escape',
      'F5',
      'Shift',
      'Control',
    ]) {
      expect(writes(key({ key: one }), false), one).toBe(false)
    }
    expect(writes(key({ key: 's', ctrlKey: true }), false)).toBe(false)
    expect(writes(key({ key: 'c', metaKey: true }), true)).toBe(false)
    expect(writes(key({ key: '1', altKey: true }), false)).toBe(false)
  })

  test('AltGr writes, and so does Option on a Mac', () => {
    expect(writes(key({ key: '@', ctrlKey: true, altKey: true, altGraph: true }), false)).toBe(true)
    expect(writes(key({ key: '€', altKey: true }), true)).toBe(true)
  })
})

describe('what takes words', () => {
  test('a note, a field, a text area', () => {
    expect(takesWords(note as unknown as EventTarget)).toBe(true)
    expect(takesWords(new FakeInput() as unknown as EventTarget)).toBe(true)
    expect(takesWords(new FakeTextArea() as unknown as EventTarget)).toBe(true)
  })

  test('not a locked field, a checkbox, a button or plain page', () => {
    const locked = Object.assign(new FakeInput(), { readOnly: true })
    const box = Object.assign(new FakeInput(), { type: 'checkbox' })
    const off = Object.assign(new FakeTextArea(), { disabled: true })

    for (const one of [locked, box, off, new FakeElement(), null]) {
      expect(takesWords(one as unknown as EventTarget)).toBe(false)
    }
  })
})

describe('the pointer', () => {
  test('hides on a key that writes into a note, and listens for the move only then', () => {
    expect(listened.has('pointermove')).toBe(false)

    typing.handleEvent(key({ key: 'a' }))

    expect(hidden()).toBe(true)
    expect(listened.has('pointermove')).toBe(true)
  })

  test('comes back on the first move that moves, and stops listening for it', () => {
    typing.handleEvent(key({ key: 'a' }))

    typing.handleEvent(pointer('pointermove'))
    expect(hidden()).toBe(true)

    typing.handleEvent(pointer('pointermove', { movementX: 1 }))
    expect(hidden()).toBe(false)
    expect(listened.has('pointermove')).toBe(false)
  })

  test('comes back on a move an engine says moved nothing, by where the pointer is', () => {
    typing.handleEvent(key({ key: 'a' }))

    typing.handleEvent(pointer('pointermove', { clientX: 40, clientY: 10 }))
    typing.handleEvent(pointer('pointermove', { clientX: 40, clientY: 10 }))
    expect(hidden()).toBe(true)

    typing.handleEvent(pointer('pointermove', { clientX: 60, clientY: 12 }))
    expect(hidden()).toBe(false)
  })

  test('comes back on a press, and on the window losing the keyboard', () => {
    typing.handleEvent(key({ key: 'a' }))
    typing.handleEvent(pointer('pointerdown'))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'b' }))
    typing.handleEvent({ type: 'blur' } as Event)
    expect(hidden()).toBe(false)
  })

  test('stays while a shortcut, an arrow or a key outside anything typable is pressed', () => {
    typing.handleEvent(key({ key: 's', ctrlKey: true }))
    typing.handleEvent(key({ key: 'ArrowDown' }))
    typing.handleEvent(key({ key: 'a', target: new FakeElement() }))

    expect(hidden()).toBe(false)
  })

  test('never while a button is held', () => {
    typing.handleEvent(pointer('pointerdown'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(true)
  })

  test('never after a touch or a pen, until the mouse is back', () => {
    typing.handleEvent(pointer('pointerdown', { pointerType: 'touch' }))
    typing.handleEvent(pointer('pointerup', { pointerType: 'touch' }))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerdown', { pointerType: 'pen' }))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(false)

    typing.handleEvent(pointer('pointerdown'))
    typing.handleEvent(pointer('pointerup'))
    typing.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(true)
  })

  test('costs a hundred keys in a row one change to the page', () => {
    let changes = 0
    const counting = Object.assign(new FakeElement(), {
      classList: { add: () => changes++, remove: () => changes++ },
    })
    const counted = new TypingPointer(listening, false)
    counted.handleEvent(pointer('pointerover', {}, counting))

    for (let n = 0; n < 100; n++) counted.handleEvent(key({ key: 'a' }))

    expect(changes).toBe(1)
  })

  test('is hidden on the one element under it, so the rest of the page is not restyled', () => {
    const field = Object.assign(new FakeElement(), { isContentEditable: true })
    typing.handleEvent(key({ key: 'a', target: field }))
    expect(hidden()).toBe(true)
    expect(field.worn.size).toBe(0)
  })

  test('is left as it is before it has been over the window', () => {
    const fresh = new TypingPointer(listening, false)
    fresh.handleEvent(key({ key: 'a' }))
    expect(listened.has('pointermove')).toBe(false)
  })

  test('moves at once onto what replaced the element it was hidden on', () => {
    const watching: { changed: (() => void) | null } = { changed: null }
    const after = new FakeElement()
    const asked: number[][] = []
    const watched = new TypingPointer(listening, false, {
      watch: (one) => {
        watching.changed = one
        return () => (watching.changed = null)
      },
      at: (x, y) => {
        asked.push([x, y])
        return after as unknown as Element
      },
    })
    watched.handleEvent(pointer('pointerover', { clientX: 40, clientY: 70 }))
    watched.handleEvent(key({ key: 'a' }))
    expect(hidden()).toBe(true)

    watching.changed?.()
    expect(asked).toEqual([])

    Object.assign(under, { isConnected: false })
    watching.changed?.()
    expect(asked).toEqual([[40, 70]])
    expect(after.worn.has(HIDDEN)).toBe(true)

    watched.handleEvent(pointer('pointerdown'))
    expect(after.worn.size).toBe(0)
    expect(watching.changed).toBeNull()
  })

  test('stays hidden on what comes under it while it rests', () => {
    typing.handleEvent(key({ key: 'a' }))
    const next = new FakeElement()
    typing.handleEvent(pointer('pointerover', {}, next))
    expect(next.worn.has(HIDDEN)).toBe(true)
    expect(hidden()).toBe(false)

    const after = new FakeElement()
    typing.handleEvent(pointer('pointermove', {}, after))
    expect(after.worn.has(HIDDEN)).toBe(true)
    expect(next.worn.size).toBe(0)

    typing.handleEvent(pointer('pointermove', { movementX: 2 }, after))
    expect(after.worn.size).toBe(0)
  })
})
