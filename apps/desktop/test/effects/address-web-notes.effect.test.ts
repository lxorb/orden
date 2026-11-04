/** Ctrl+T's address field offers the space's websites (#1059): found by a few letters of
 *  their name or address, marked as saved, opened as the note with the arrows and Enter
 *  or a press, and taken into the field with Tab. A private tab's field offers none. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

vi.mock('../../src/lib/link-index.svelte', () => ({
  links: {
    rootOf: () => '/space',
    websitesHere: new Map([
      ['Uni/Moodle.url', { address: 'https://moodle-app2.let.ethz.ch/my/', favicon: null }],
      [
        'Code/GitHub issues.url',
        { address: 'https://github.com/lxorb/orden/issues', favicon: null },
      ],
    ]),
    faviconOf: () => null,
    shortcutOf: () => null,
    iconOf: () => null,
    tintOf: () => null,
  },
}))

const AddressField = (await import('../../src/lib/web-tab/AddressField.svelte')).default

let target: HTMLElement | null = null
let app: ReturnType<typeof mount> | null = null

function open(onnote?: (path: string) => void) {
  target = document.createElement('div')
  document.body.append(target)
  app = mount(AddressField, {
    target,
    props: {
      resting: '',
      address: '',
      book: 'tests-web-notes',
      onenter: () => undefined,
      ontyping: () => undefined,
      onnote,
    },
  })
  flushSync()
}

afterEach(() => {
  if (app) void unmount(app)
  target?.remove()
  app = null
  target = null
})

function field(): HTMLInputElement {
  const found = target?.querySelector('input')
  if (!found) throw new Error('no field')
  return found
}

function type(letters: string) {
  const box = field()
  box.focus()
  flushSync()
  box.value = letters
  box.setSelectionRange(letters.length, letters.length)
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  flushSync()
}

function press(key: string) {
  field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}

const options = () => [...(target?.querySelectorAll('[role="option"]') ?? [])]

test('a website is offered by letters of its name, marked as saved', () => {
  open(() => undefined)
  type('moo')

  const [first] = options()
  expect(first?.textContent).toContain('Moodle')
  expect(first?.textContent).toContain('moodle-app2.let.ethz.ch/my/')
  expect(first?.querySelector('.badge')?.textContent).toBe('Saved')
  expect(first?.querySelector('.matched')?.textContent).toBe('Moo')
})

test('and by its address, with a typo', () => {
  open(() => undefined)
  type('lxorb')
  expect(options()[0]?.textContent).toContain('GitHub issues')

  type('githb isues')
  expect(options()[0]?.textContent).toContain('GitHub issues')
})

test('the arrows and Enter open it as the note it is', () => {
  const opened: string[] = []
  open((path) => opened.push(path))
  type('moo')
  press('ArrowDown')
  expect(field().value).toBe('moodle-app2.let.ethz.ch/my/')
  press('Enter')
  expect(opened).toEqual(['/space/Uni/Moodle.url'])
})

test('a press opens it too', () => {
  const opened: string[] = []
  open((path) => opened.push(path))
  type('github')
  options()[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  expect(opened).toEqual(['/space/Code/GitHub issues.url'])
})

test('Tab takes the row the arrows are on into the field, to type on from', () => {
  open(() => undefined)
  type('moo')
  press('ArrowDown')
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  field().dispatchEvent(tab)
  flushSync()
  expect(tab.defaultPrevented).toBe(true)
  expect(field().value).toBe('moodle-app2.let.ethz.ch/my/')
  expect(field().selectionStart).toBe(field().value.length)
})

test('Tab with nothing to take moves on, as Tab does', () => {
  open(() => undefined)
  type('zzzz')
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  field().dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false)
})

test("a private tab's field offers none", () => {
  open(undefined)
  type('moo')
  expect(options()).toHaveLength(0)
})
