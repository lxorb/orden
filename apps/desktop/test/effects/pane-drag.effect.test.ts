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
