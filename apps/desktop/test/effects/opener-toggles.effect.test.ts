import { afterEach, beforeEach, expect, test } from 'vitest'
import { menu } from '../../src/lib/menu.svelte'
import { overlays } from '../../src/lib/overlays'

/** A second press on the control that opened a menu, a popover or a picker closes it,
 *  and does not open it again (#1039).
 *
 *  The press past a popup closed it on its way down, and the click of the same press
 *  then reached the button that had opened it, which opened it again: the `⋯` on a web
 *  tab's bar, and every button of its kind. A popup that held its button stayed open on
 *  the way down, and then each button had to toggle by itself, and a key - which presses
 *  nothing down - went to the button's own answer either way. So the control is noticed
 *  by overlays.ts as its click goes by, whatever opens, and a click on it while what it
 *  opened is open closes that. Played here the way App.svelte wires it: the press and
 *  the click read on the way down, before the button hears them. */

let host: HTMLElement
let opened = 0
let shut = 0

/** A button that opens a popup, as every one in the app does: its click sets some
 *  state, and an effect puts the popup on the stack a moment later. `holdsButton` is the
 *  shape some popups took to stay open for a press on their button. */
function trigger(holdsButton = false) {
  const button = host.appendChild(document.createElement('button'))
  const label = button.appendChild(document.createElement('span'))
  const surface = host.appendChild(document.createElement('div'))
  const it = { open: false, off: null as (() => void) | null }

  button.addEventListener('click', () => {
    if (it.open) {
      it.off?.()
      it.open = false
      return
    }
    it.open = true
    opened++
    queueMicrotask(() => {
      it.off = overlays.show(
        () => {
          it.open = false
          shut++
        },
        () => (holdsButton ? [surface, button] : [surface]),
      )
    })
  })

  return { button, label, surface, it }
}

/** A press: down, then the click, each read by the stack first. */
async function press(target: Element, pointer = true) {
  if (pointer) target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise((done) => setTimeout(done, 0))
}

const onDown = (event: Event) => overlays.pressed(event)
const onClick = (event: Event) => overlays.clicked(event)

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  opened = 0
  shut = 0
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('click', onClick, true)
})

afterEach(() => {
  while (overlays.escape()) {
    // Whatever a test left open.
  }
  document.removeEventListener('pointerdown', onDown, true)
  document.removeEventListener('click', onClick, true)
  host.remove()
})

test.each([false, true])(
  'a second press on the button closes what it opened, once (holds its button: %s)',
  async (holdsButton) => {
    const { button, label, it } = trigger(holdsButton)
    await press(button)
    expect(it.open).toBe(true)

    await press(label)
    expect(it.open).toBe(false)
    expect([opened, shut]).toEqual([1, 1])
    expect(overlays.depth).toBe(0)

    // And the press after that opens it again.
    await press(button)
    expect(it.open).toBe(true)
    expect(opened).toBe(2)
  },
)

test('so does Enter or Space on it, which press nothing down', async () => {
  const { button, it } = trigger()
  await press(button, false)
  expect(it.open).toBe(true)

  await press(button, false)
  expect(it.open).toBe(false)
  expect([opened, shut]).toEqual([1, 1])
})

test('a press inside what it opened leaves it open, and one elsewhere closes it', async () => {
  const { button, surface, it } = trigger()
  await press(button)
  await press(surface.appendChild(document.createElement('span')))
  expect(it.open).toBe(true)

  await press(host.appendChild(document.createElement('p')))
  expect(it.open).toBe(false)
})

test('the button says it is open while it is, and what it said before once it closes', async () => {
  const { button } = trigger()
  await press(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')

  await press(button)
  expect(button.hasAttribute('aria-expanded')).toBe(false)

  button.setAttribute('aria-expanded', 'false')
  await press(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  overlays.escape()
  expect(button.getAttribute('aria-expanded')).toBe('false')
})

test('Escape gives the keyboard back to the button', async () => {
  const { button } = trigger()
  await press(button)
  ;(document.activeElement as HTMLElement | null)?.blur()

  overlays.escape()
  await new Promise((done) => setTimeout(done, 0))
  expect(document.activeElement).toBe(button)
})

test('a popup opened by no click has no button to be closed from', async () => {
  const other = host.appendChild(document.createElement('button'))
  let open = true
  overlays.show(
    () => (open = false),
    () => [],
  )
  await press(other, false)
  // A click past it with nothing pressed down: not its button, and so not its to close.
  expect(open).toBe(true)
})

test('the menu a button opens knows the button, and one a right click opens does not', () => {
  const button = host.appendChild(document.createElement('button'))
  const dots = button.appendChild(document.createElement('svg'))
  const items = [{ label: 'One', run: () => undefined }]

  const click = new MouseEvent('click', { bubbles: true })
  Object.defineProperty(click, 'target', { value: dots })
  menu.show(click, items)
  expect(menu.from).toBe(button)

  const right = new MouseEvent('contextmenu', { bubbles: true })
  Object.defineProperty(right, 'target', { value: dots })
  menu.show(right, items)
  expect(menu.from).toBeNull()
  menu.hide()
})
