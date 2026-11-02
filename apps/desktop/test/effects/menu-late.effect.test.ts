/** The first menu opens as its chunk lands, which may be after the press that opened it
 *  has been let go of (#442). That release never reached the menu, and the next one it
 *  heard was read as it: a press on a row's chevron chose the row. */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ContextMenu from '../../src/lib/ContextMenu.svelte'
import { menu } from '../../src/lib/menu.svelte'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  menu.hide()
  flushSync()
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

function pointer(type: string, on: Element, at: { x: number; y: number }, buttons = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, buttons })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  on.dispatchEvent(event)
}

describe('a menu that landed after the press that opened it was let go of', () => {
  test('hears the next press as a press, so a chevron is the chevron and not the row', () => {
    const run = vi.fn()
    const more = vi.fn(() => Promise.resolve([]))

    // Pressed and let go of before there is a menu to hear it.
    const press = new MouseEvent('contextmenu', { clientX: 10, clientY: 10, buttons: 2 })
    menu.show(press, [{ label: 'Open', run, more }])

    const host = document.createElement('div')
    document.body.append(host)
    shown = mount(ContextMenu, { target: host })
    flushSync()

    const chevron = host.querySelector('[data-more]')
    if (!chevron) throw new Error('no chevron')
    const at = { x: 200, y: 200 }
    document.elementFromPoint = () => chevron

    pointer('pointerdown', chevron, at, 1)
    pointer('pointerup', chevron, at)
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(run).not.toHaveBeenCalled()
    expect(more).toHaveBeenCalledOnce()
  })

  /** A second button pressed while the first is still held is that press going on. */
  test('and a press made while the one that opened it is held does not end it', () => {
    const run = vi.fn()

    const press = new MouseEvent('contextmenu', { clientX: 10, clientY: 10, buttons: 2 })
    menu.show(press, [{ label: 'Open', run }])

    const host = document.createElement('div')
    document.body.append(host)
    shown = mount(ContextMenu, { target: host })
    flushSync()

    const row = host.querySelector('[role="menuitem"]')
    if (!row) throw new Error('no row')
    document.elementFromPoint = () => row
    const at = { x: 200, y: 200 }

    pointer('pointerdown', row, at, 3)
    pointer('pointerup', row, at)

    expect(run).toHaveBeenCalledOnce()
  })
})
