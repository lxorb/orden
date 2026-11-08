import { beforeEach, describe, expect, test } from 'vitest'
import { Panes } from '../../src/lib/workspace/panes.svelte'

describe('a drag over the panes', () => {
  let panes: Panes

  beforeEach(() => {
    panes = new Panes(() => undefined)
  })

  test('lights the zones while it is under way', () => {
    panes.dragged({ tabId: 't1' })
    expect(panes.dragging).toEqual({ tabId: 't1' })
  })

  test('is over when the drag ends', () => {
    panes.dragged({ tabId: 't1' })
    window.dispatchEvent(new Event('dragend'))
    expect(panes.dragging).toBeNull()
  })

  test('is over on a drop, even though the row it began on has gone', () => {
    panes.dragged({ tabId: 't1' })
    window.dispatchEvent(new Event('drop'))
    expect(panes.dragging).toBeNull()
  })

  test('and takes the landing with it, so no zone is left lit', () => {
    panes.dragged({ tabId: 't1' })
    panes.landing = { kind: 'pane', paneId: 'p1', zone: 'middle' }
    window.dispatchEvent(new Event('drop'))
    expect(panes.landing).toBeNull()
  })

  test('is not ended by the drag before it', () => {
    panes.dragged({ tabId: 'first' })
    panes.dragged({ tabId: 'second' })
    expect(panes.dragging).toEqual({ tabId: 'second' })

    window.dispatchEvent(new Event('dragend'))
    expect(panes.dragging).toBeNull()

    panes.dragged({ tabId: 'third' })
    expect(panes.dragging).toEqual({ tabId: 'third' })
  })

  test('can be ended by hand, and ending one that is over is harmless', () => {
    panes.dragged({ tabId: 't1' })
    panes.dropped()
    expect(panes.dragging).toBeNull()

    panes.dropped()
    expect(panes.dragging).toBeNull()
  })
})

describe('a drag whose row went away while it was carried', () => {
  let panes: Panes

  beforeEach(() => {
    panes = new Panes(() => undefined)
  })

  const pointer = (type: string, buttons: number) => {
    const event = new MouseEvent(type, { bubbles: true, buttons })
    document.body.dispatchEvent(event)
  }

  test('is over once the pointer moves free, though no end of the drag ever reached the window', () => {
    panes.dragged({ tabId: null })
    panes.landing = { kind: 'pane', paneId: 'p1', zone: 'left' }
    pointer('pointermove', 0)
    expect(panes.dragging).toBeNull()
    expect(panes.landing).toBeNull()
  })

  test('is over on the next press', () => {
    panes.dragged({ tabId: null })
    pointer('pointerdown', 1)
    expect(panes.dragging).toBeNull()
  })

  test('is over when a drop on a space keeps the drop from the window', () => {
    const swallow = (event: Event) => event.stopPropagation()
    window.addEventListener('drop', swallow, { capture: true })
    panes.dragged({ tabId: null })
    document.body.dispatchEvent(new Event('drop', { bubbles: true }))
    window.removeEventListener('drop', swallow, { capture: true })
    pointer('pointermove', 0)
    expect(panes.dragging).toBeNull()
  })

  test('is not ended by a move with the button still held', () => {
    panes.dragged({ tabId: null })
    pointer('pointermove', 1)
    expect(panes.dragging).toEqual({ tabId: null })
  })

  test('lets the place it began tidy up once, and not when it ends there itself', () => {
    let tidied = 0
    panes.dragged({ tabId: null }, () => (tidied += 1))
    pointer('pointermove', 0)
    pointer('pointerdown', 1)
    expect(tidied).toBe(1)

    panes.dragged({ tabId: null }, () => (tidied += 1))
    panes.dropped()
    pointer('pointermove', 0)
    expect(tidied).toBe(1)
  })
})
