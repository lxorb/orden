import { describe, expect, test } from 'vitest'
import { isRegion, REGIONS, stepRegion } from './regions'

/** Walking the regions of the window with one key.
 *
 *  What is on screen changes - the sidebar shuts, a canvas has no status bar, a
 *  phone has no strip of tabs - so the key walks whatever is there rather than a
 *  fixed seven. See focus.ts for the half that finds them. */

/** A desktop window with the sidebar open, as the page reports it. Deliberately
 *  out of order: what arrives is the order the DOM was asked in, and the order the
 *  key walks is the one the list decides. */
const WINDOW = ['editor', 'list', 'status', 'panels', 'foot', 'tabs', 'space', 'search']

describe('the order', () => {
  test('runs down the sidebar and then across the note', () => {
    expect([...REGIONS]).toEqual([
      'space',
      'panels',
      'search',
      'list',
      'foot',
      'tabs',
      'editor',
      'status',
    ])
  })

  test('knows a region from anything else on the page', () => {
    expect(isRegion('editor')).toBe(true)
    expect(isRegion('sidebar')).toBe(false)
    expect(isRegion(null)).toBe(false)
    expect(isRegion(undefined)).toBe(false)
  })
})

describe('one step along', () => {
  test('goes to the next region on screen, in the order the window draws them', () => {
    expect(stepRegion(WINDOW, 'space', 1)).toBe('panels')
    expect(stepRegion(WINDOW, 'panels', 1)).toBe('search')
    expect(stepRegion(WINDOW, 'list', 1)).toBe('foot')
    expect(stepRegion(WINDOW, 'foot', 1)).toBe('tabs')
    expect(stepRegion(WINDOW, 'tabs', 1)).toBe('editor')
  })

  test('and back the other way', () => {
    expect(stepRegion(WINDOW, 'editor', -1)).toBe('tabs')
    expect(stepRegion(WINDOW, 'space', -1)).toBe('status')
  })

  /** A ring, because one key has to be able to walk round: a press that stops on
   *  the status bar with nowhere left to go reads as a key that has broken. */
  test('meets its own ends', () => {
    expect(stepRegion(WINDOW, 'status', 1)).toBe('space')
    expect(stepRegion(WINDOW, 'space', -1)).toBe('status')
  })

  /** The whole point of the key: Tab indents inside a note, so this is the only
   *  way out of one. */
  test('leaves the note', () => {
    expect(stepRegion(WINDOW, 'editor', 1)).toBe('status')
  })

  /** A fresh window has the focus on the page itself and no region at all. */
  test('lands at the end the key came from when the keyboard is nowhere', () => {
    expect(stepRegion(WINDOW, null, 1)).toBe('space')
    expect(stepRegion(WINDOW, null, -1)).toBe('status')
  })

  test('and does the same from a region that has since gone', () => {
    expect(stepRegion(['editor', 'status'], 'list', 1)).toBe('editor')
  })
})

describe('a window with less in it', () => {
  /** The sidebar shut, which is most of what full screen and a phone look like. */
  test('walks only what is there', () => {
    const shut = ['editor', 'tabs', 'status']
    expect(stepRegion(shut, 'editor', 1)).toBe('status')
    expect(stepRegion(shut, 'status', 1)).toBe('tabs')
    expect(stepRegion(shut, 'tabs', 1)).toBe('editor')
  })

  /** A note being presented, or full screen with nothing else drawn. */
  test('stays where it is when the note is the whole window', () => {
    expect(stepRegion(['editor'], 'editor', 1)).toBe('editor')
    expect(stepRegion(['editor'], 'editor', -1)).toBe('editor')
  })

  test('and answers nothing at all where there is nothing', () => {
    expect(stepRegion([], null, 1)).toBeNull()
    expect(stepRegion([], 'editor', 1)).toBeNull()
  })

  /** Anything on the page that is not one of the seven is not a region, whatever
   *  it calls itself. */
  test('ignores a name it does not know', () => {
    expect(stepRegion(['editor', 'canvas', 'status'], 'editor', 1)).toBe('status')
  })

  /** The same region twice - two panes, each with a strip - is one region. */
  test('counts a region once however many times it is drawn', () => {
    expect(stepRegion(['tabs', 'editor', 'tabs', 'editor'], 'tabs', 1)).toBe('editor')
    expect(stepRegion(['tabs', 'editor', 'tabs'], 'editor', 1)).toBe('tabs')
  })
})
