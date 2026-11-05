import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import app from '../App.svelte?raw'
import crateSide from '../../src-tauri/src/keyboard.rs?raw'

/** A site taking the keyboard is the one handoff out of the app's own page (#1036).
 *
 *  A web tab's page is a native view beside the app's: a press into it never reaches the
 *  app's HTML. The address field stayed focused with its whole address selected while the
 *  page was in use, because the only word the app's page had was its window's `blur`,
 *  which CEF on Linux sometimes never sent, and which on every engine left the element
 *  focused for the engine to focus again - selection and all - the next time the app's
 *  page got the keyboard. These hold the handoff for any control at all: none of them
 *  knows a page exists, so a control added later is let go of the same way.
 *
 *  In the jsdom project, because focus, selection and events are the DOM's own. The crate
 *  is stood in for: `keyboard_went` answers whether a page of the window has the keyboard,
 *  and `IN_PAGE` is the word it sends as one takes it. */

const crate = vi.hoisted(() => ({
  /** Whether a page of this window has the keyboard, as `keyboard_went` answers. */
  inPage: true,
  /** An answer held back, for a word that arrives late. */
  hold: null as Promise<void> | null,
  heard: new Map<string, () => void>(),
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  invoke: async (command: string) => {
    if (command !== 'keyboard_went') return undefined
    if (crate.hold) await crate.hold
    return crate.inPage
  },
}))
vi.mock('./own-window', () => ({
  hearHere: (name: string, then: () => void) => {
    crate.heard.set(name, then)
    return Promise.resolve(() => undefined)
  },
}))

const { IN_PAGE } = await import('./keyboard-home')
const { overlays } = await import('./overlays')
const { IN_A_PAGE } = await import('./trap')

/** A turn for the crate's answer, and a frame for anything that waits one. */
async function settled() {
  await new Promise((done) => setTimeout(done, 40))
}

/** The crate saying a page of this window took the keyboard, and no `blur` from the engine:
 *  CEF on Linux, as it was. */
async function pageTookIt() {
  await vi.waitFor(() => expect(crate.heard.has(IN_PAGE)).toBe(true))
  crate.heard.get(IN_PAGE)?.()
  await settled()
}

/** The engine's own word: the window's `blur`, after which it says the page has no
 *  keyboard. */
async function windowBlurred() {
  focused = false
  window.dispatchEvent(new FocusEvent('blur'))
  await settled()
}

/** The app's page getting the keyboard back without anything in it chosen: a press on an
 *  empty part of it, or a layer of its own given it. */
async function windowFocused() {
  focused = true
  window.dispatchEvent(new FocusEvent('focus'))
  await settled()
}

let blurs = 0
/** What the engine says `document.hasFocus()` is. */
let focused = true
const counted = () => (blurs += 1)

function control(html: string): HTMLElement {
  const holder = document.createElement('div')
  holder.innerHTML = html
  document.body.append(holder)
  const one = holder.firstElementChild
  if (!(one instanceof HTMLElement)) throw new Error('no control')
  return one
}

beforeEach(() => {
  crate.inPage = true
  crate.hold = null
  blurs = 0
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  window.addEventListener('blur', counted)
})

afterEach(async () => {
  window.removeEventListener('blur', counted)
  // The app's page has the keyboard again for the next test, by a press in it.
  window.dispatchEvent(new Event('pointerdown'))
  await windowFocused()
  ;(document.activeElement as HTMLElement | null)?.blur()
  document.body.replaceChildren()
  document.documentElement.removeAttribute(IN_A_PAGE)
  vi.restoreAllMocks()
})

describe('a site taking the keyboard', () => {
  test('lets go of the address field, its selection with it, on the crate s word alone', async () => {
    const field = control('<input value="https://github.com/users/lxorb/projects/2">')
    field.focus()
    ;(field as HTMLInputElement).select()
    const lost = vi.fn()
    field.addEventListener('blur', lost)

    await pageTookIt()

    expect(document.activeElement).toBe(document.body)
    expect(lost).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute(IN_A_PAGE)).toBe(true)
    // Whatever listens for the window going heard it, once, though the engine never sent it.
    expect(blurs).toBe(1)
  })

  test.each([
    ['a field', '<input value="find this">'],
    ['a box of text', '<textarea>words</textarea>'],
    ['a list', '<select><option>one</option></select>'],
    ['a button', '<button>Menu</button>'],
    ['anything focusable', '<div tabindex="-1">row</div>'],
    ['an editor', '<div contenteditable="true">a note</div>'],
  ])('lets go of %s, which knows nothing of pages', async (_kind, html) => {
    const one = control(html)
    one.focus()
    expect(document.activeElement).toBe(one)

    await pageTookIt()

    expect(document.activeElement).toBe(document.body)
  })

  test('takes down a selection inside what had the keyboard', async () => {
    const editor = control('<div contenteditable="true">a note being written</div>')
    editor.focus()
    getSelection()?.selectAllChildren(editor)
    expect(getSelection()?.isCollapsed).toBe(false)

    await pageTookIt()

    expect(getSelection()?.isCollapsed ?? true).toBe(true)
  })

  test('closes the popups open over the page, as a press anywhere else would', async () => {
    const menu = control('<div role="menu"><button>Reload</button></div>')
    const closed = vi.fn()
    const off = overlays.show(closed, () => [menu])
    menu.querySelector('button')?.focus()
    // What App.svelte puts on the window, read off it so the two cannot part.
    expect(app).toContain('onblur={() => overlays.away()}')
    const away = () => overlays.away()
    window.addEventListener('blur', away)

    await pageTookIt()

    window.removeEventListener('blur', away)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(overlays.depth).toBe(0)
    off()
  })

  test('on the engine s blur alone, as on a Mac, and never plays a second one', async () => {
    const field = control('<input value="https://example.com">')
    field.focus()

    await windowBlurred()
    expect(document.activeElement).toBe(document.body)
    // And the crate's word after it changes nothing more.
    await pageTookIt()
    expect(blurs).toBe(1)
  })

  test('plays the window s blur once each time the keyboard goes', async () => {
    await pageTookIt()
    // The X server says it twice, as focus moves inside the page's window.
    await pageTookIt()
    expect(blurs).toBe(1)
    // A press on the bar's menu button, and a press back into the page: the menu hears it.
    window.dispatchEvent(new Event('pointerdown'))
    await pageTookIt()
    expect(blurs).toBe(2)
  })

  test('is not given back to the field as the app s page gets the keyboard again', async () => {
    const field = control('<input value="https://example.com">')
    field.focus()
    ;(field as HTMLInputElement).select()
    await pageTookIt()

    await windowFocused()

    expect(document.activeElement).toBe(document.body)
  })
})

describe('the keyboard going anywhere else', () => {
  test('to another program leaves the field where it was, for the window coming back', async () => {
    crate.inPage = false
    const field = control('<input value="half typed">')
    field.focus()

    await windowBlurred()

    expect(document.activeElement).toBe(field)
    expect(document.documentElement.hasAttribute(IN_A_PAGE)).toBe(false)
  })

  test('a word that arrives after a person pressed here again is not acted on', async () => {
    let answer: () => void = () => undefined
    crate.hold = new Promise<void>((done) => {
      answer = done
    })
    const field = control('<input value="https://example.com">')
    field.focus()

    await vi.waitFor(() => expect(crate.heard.has(IN_PAGE)).toBe(true))
    crate.heard.get(IN_PAGE)?.()
    // Back in the field before the crate answered.
    window.dispatchEvent(new Event('pointerdown'))
    field.focus()
    answer()
    await settled()

    expect(document.activeElement).toBe(field)
  })
})

test('the crate and the page name the word the same', () => {
  expect(crateSide).toContain(`pub const IN_PAGE: &str = "${IN_PAGE}";`)
})
