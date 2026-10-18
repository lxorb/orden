/** A half-typed address, across a switch of windows.
 *
 *  Emil, 2026-09-30, of coming back to nib: the keyboard goes back where it was, and the
 *  address field is one of those places. The engine keeps the field focused while the
 *  window is away and says blur and focus to it all the same; the field used to take
 *  both for the reader leaving it, and came back with the whole address selected over
 *  what they had typed. Chrome's field keeps it, caret and all, while the page stays. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { HalfTyped } from '../../src/lib/web-tab/typed'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

const AddressField = (await import('../../src/lib/web-tab/AddressField.svelte')).default

const ADDRESS = 'https://example.com/page'

let target: HTMLElement
let app: ReturnType<typeof mount>
let address = ADDRESS

function field(): HTMLInputElement {
  const found = target.querySelector('input')
  if (!found) throw new Error('no field')
  return found
}

/** The field focused and a few letters typed over the address it offers. */
function typed(letters: string) {
  const box = field()
  box.focus()
  flushSync()
  box.value = letters
  box.setSelectionRange(2, 2)
  box.dispatchEvent(new InputEvent('input', { bubbles: true }))
  flushSync()
}

/** The window going away and coming back: the page is told blur and focus while the
 *  field stays the document's focused element throughout. */
function awayAndBack() {
  const box = field()
  box.dispatchEvent(new FocusEvent('blur'))
  flushSync()
  box.dispatchEvent(new FocusEvent('focus'))
  flushSync()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  address = ADDRESS
  app = mount(AddressField, {
    target,
    props: {
      resting: 'Example',
      get address() {
        return address
      },
      book: 'tests',
      onenter: () => undefined,
      ontyping: () => undefined,
    },
  })
  flushSync()
})

afterEach(() => {
  void unmount(app)
  target.remove()
})

test('comes back with what was typed and where the caret was', () => {
  typed('exa')
  awayAndBack()
  expect(field().value).toBe('exa')
  expect(field().selectionStart).toBe(2)
  expect(field().selectionEnd).toBe(2)
})

test('the reader leaving the field still puts its resting face back', () => {
  typed('exa')
  field().blur()
  flushSync()
  expect(field().value).toBe('Example')

  field().focus()
  flushSync()
  expect(field().value).toBe(ADDRESS)
})

test('nothing typed is the whole address again, selected', () => {
  field().focus()
  flushSync()
  awayAndBack()
  expect(field().value).toBe(ADDRESS)
  expect(field().selectionStart).toBe(0)
  expect(field().selectionEnd).toBe(ADDRESS.length)
})

/** #381: a new tab's address half typed, another tab, and back. The pane builds a new bar
 *  for the tab that comes back, so what the old field held waits on the tab's page. */
describe('across a switch of tabs', () => {
  const page = { halfTyped: null as HalfTyped | null }
  let other: ReturnType<typeof mount> | null = null
  let gone = ''

  /** The tab's bar, as the pane builds it each time the tab is in front. */
  function bar() {
    if (other) void unmount(other)
    target.replaceChildren()
    other = mount(AddressField, {
      target,
      props: {
        resting: '',
        address: '',
        book: 'tests',
        held: page,
        onenter: (said: string) => (gone = said),
        ontyping: () => undefined,
      },
    })
    flushSync()
  }

  /** Words typed into the new tab's empty field, the caret put back among them. */
  function into(words: string, caret: number) {
    const box = field()
    box.focus()
    flushSync()
    box.value = words
    box.dispatchEvent(new InputEvent('input', { bubbles: true }))
    box.setSelectionRange(caret, caret)
    box.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
    flushSync()
  }

  beforeEach(() => {
    page.halfTyped = null
    gone = ''
    void unmount(app)
    bar()
  })

  afterEach(() => {
    if (other) void unmount(other)
    other = null
    app = mount(AddressField, {
      target,
      props: {
        resting: '',
        address: '',
        book: 'tests',
        onenter: () => undefined,
        ontyping: () => undefined,
      },
    })
  })

  test('another tab pressed: back on it, the words are there and so is the caret', () => {
    into('weather in zur', 8)
    // The press on another tab takes the keyboard first, and then the tab goes.
    field().blur()
    flushSync()
    bar()

    const box = field()
    box.focus()
    flushSync()
    expect(box.value).toBe('weather in zur')
    expect([box.selectionStart, box.selectionEnd]).toEqual([8, 8])
  })

  test('Ctrl+Tab typed into the field: the tab goes with the field still focused', () => {
    into('news', 2)
    bar()

    field().focus()
    flushSync()
    expect(field().value).toBe('news')
    expect(field().selectionStart).toBe(2)
  })

  test('Enter took it where it was going: nothing is waiting when the tab comes back', () => {
    into('example.org', 11)
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(gone).toBe('example.org')
    bar()

    field().focus()
    flushSync()
    expect(field().value).toBe('')
    expect(page.halfTyped).toBeNull()
  })

  test('Escape twice gave it up: nothing is waiting either', () => {
    into('half', 4)
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flushSync()
    bar()
    expect(page.halfTyped).toBeNull()
  })
})
