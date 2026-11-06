import { createEditor, type EditorView } from '@orden/editor'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const asked: string[] = []
let pageTakesIt = false

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  invoke: (command: string) => {
    asked.push(command)
    const paged = command === 'keyboard_back' || command === 'keyboard_went'
    return Promise.resolve(paged ? pageTakesIt : undefined)
  },
}))

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const { overlays } = await import('../../src/lib/overlays')
const { adrift, pressedThrough } = await import('../../src/lib/keyboard-home')

let editor: EditorView
let terminal: HTMLTextAreaElement
let place: HTMLElement

async function frames(count = 4) {
  for (let one = 0; one < count; one++) {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)))
  }
}

async function awayAndBack(lost: boolean) {
  window.dispatchEvent(new FocusEvent('blur'))
  if (lost) (document.activeElement as HTMLElement | null)?.blur()
  const having = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  window.dispatchEvent(new FocusEvent('focus'))
  await frames(2)
  having.mockRestore()
}

function layer(): () => void {
  const box = document.createElement('div')
  box.className = 'nib-layer'
  const field = document.createElement('input')
  box.append(field)
  document.body.append(box)
  const off = overlays.show(() => undefined)
  field.focus()
  return () => {
    off()
    box.remove()
  }
}

beforeEach(() => {
  place = document.createElement('div')
  place.dataset.region = 'editor'
  document.body.append(place)
  editor = createEditor({ parent: place, doc: 'Words' })
  terminal = document.createElement('textarea')
  terminal.className = 'xterm-helper-textarea'
  place.append(terminal)
  pageTakesIt = false
  window.dispatchEvent(new FocusEvent('blur'))
  document.documentElement.removeAttribute('data-keyboard-in-page')
  asked.length = 0
})

afterEach(() => {
  editor.destroy()
  place.remove()
  ;(document.activeElement as HTMLElement | null)?.blur()
})

test('the window coming back puts the keyboard back in the note', async () => {
  editor.focus()
  await awayAndBack(true)
  expect(document.activeElement).toBe(editor.contentDOM)
})

test('and in the terminal', async () => {
  terminal.focus()
  await awayAndBack(true)
  expect(document.activeElement).toBe(terminal)
})

test('an element the engine kept is left alone', async () => {
  terminal.focus()
  await awayAndBack(false)
  expect(document.activeElement).toBe(terminal)
})

test('the crate hears once that the keyboard is in the page, and again after it left', async () => {
  terminal.focus()
  editor.focus()
  expect(asked.filter((one) => one === 'keyboard_here')).toHaveLength(1)

  window.dispatchEvent(new FocusEvent('blur'))
  expect(asked).toContain('keyboard_went')
  terminal.focus()
  expect(asked.filter((one) => one === 'keyboard_here')).toHaveLength(2)
})

test('a site taking the keyboard is known to the page, until a person takes it back', async () => {
  terminal.focus()
  pageTakesIt = true
  window.dispatchEvent(new FocusEvent('blur'))
  await Promise.resolve()
  await Promise.resolve()
  expect(document.documentElement.hasAttribute('data-keyboard-in-page')).toBe(true)

  editor.focus()
  expect(document.documentElement.hasAttribute('data-keyboard-in-page')).toBe(false)
})

test('a layer closing gives the keyboard back to the note it was in', async () => {
  editor.focus()
  const close = layer()
  expect(adrift(document.activeElement)).toBe(false)
  close()
  await frames()
  expect(asked).toContain('keyboard_back')
  expect(document.activeElement).toBe(editor.contentDOM)
})

test('or to the site that had it, which the crate hands it to', async () => {
  terminal.focus()
  pageTakesIt = true
  const close = layer()
  close()
  await frames()
  expect(asked).toContain('keyboard_back')
  expect(document.activeElement).toBe(document.body)
})

test('a site never shown again leaves the keyboard with the page after a moment', async () => {
  terminal.focus()
  pageTakesIt = true
  const close = layer()
  close()
  await frames()
  expect(document.activeElement).toBe(document.body)

  const having = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  await new Promise((done) => setTimeout(done, 1100))
  having.mockRestore()
  expect(document.activeElement).toBe(terminal)
})

test('a layer that put the keyboard somewhere on its way out leaves it there', async () => {
  editor.focus()
  const close = layer()
  const name = document.createElement('input')
  document.body.append(name)
  close()
  name.focus()
  await frames()
  expect(asked).not.toContain('keyboard_back')
  expect(document.activeElement).toBe(name)
  name.remove()
})

test('a button pressed on the way to a menu is not where the keyboard was', async () => {
  terminal.focus()
  const button = document.createElement('button')
  document.body.append(button)
  window.dispatchEvent(new PointerEvent('pointerdown'))
  button.focus()
  const close = layer()
  close()
  await frames()
  expect(document.activeElement).toBe(terminal)
  button.remove()
})

test('what a press only passes through, and where the keyboard is nowhere', () => {
  for (const tag of ['button', 'a', 'summary', 'select']) {
    const one = document.createElement(tag)
    if (tag === 'a') one.setAttribute('href', '#')
    expect(pressedThrough(one), tag).toBe(true)
  }
  const tab = document.createElement('div')
  tab.setAttribute('role', 'tab')
  expect(pressedThrough(tab)).toBe(true)
  expect(pressedThrough(document.createElement('textarea'))).toBe(false)
  expect(pressedThrough(editor.contentDOM)).toBe(false)

  expect(adrift(null)).toBe(true)
  expect(adrift(document.body)).toBe(true)
  expect(adrift(document.createElement('input'))).toBe(true)
  expect(adrift(terminal)).toBe(false)
})
