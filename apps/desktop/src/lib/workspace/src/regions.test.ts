import { describe, expect, test } from 'vitest'
import { hasStatusBar, isRegion, REGIONS, stepRegion } from './regions'

const WINDOW = ['editor', 'list', 'status', 'panels', 'foot', 'tabs', 'space']

describe('the order', () => {
  test('runs down the sidebar and then across the note', () => {
    expect([...REGIONS]).toEqual([
      'space',
      'panels',
      'list',
      'foot',
      'tabs',
      'notices',
      'editor',
      'status',
      'right',
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
    expect(stepRegion(WINDOW, 'panels', 1)).toBe('list')
    expect(stepRegion(WINDOW, 'list', 1)).toBe('foot')
    expect(stepRegion(WINDOW, 'foot', 1)).toBe('tabs')
    expect(stepRegion(WINDOW, 'tabs', 1)).toBe('editor')
  })

  test('and back the other way', () => {
    expect(stepRegion(WINDOW, 'editor', -1)).toBe('tabs')
    expect(stepRegion(WINDOW, 'space', -1)).toBe('status')
  })

  test('meets its own ends', () => {
    expect(stepRegion(WINDOW, 'status', 1)).toBe('space')
    expect(stepRegion(WINDOW, 'space', -1)).toBe('status')
  })

  test('leaves the note', () => {
    expect(stepRegion(WINDOW, 'editor', 1)).toBe('status')
  })

  test('lands at the end the key came from when the keyboard is nowhere', () => {
    expect(stepRegion(WINDOW, null, 1)).toBe('space')
    expect(stepRegion(WINDOW, null, -1)).toBe('status')
  })

  test('reaches the other side of the window, and only where there is one', () => {
    expect(stepRegion(WINDOW, 'status', 1)).toBe('space')

    const both = [...WINDOW, 'right']
    expect(stepRegion(both, 'status', 1)).toBe('right')
    expect(stepRegion(both, 'right', 1)).toBe('space')
    expect(stepRegion(both, 'space', -1)).toBe('right')
  })

  test('and does the same from a region that has since gone', () => {
    expect(stepRegion(['editor', 'status'], 'list', 1)).toBe('editor')
  })
})

describe('a window with less in it', () => {
  test('walks only what is there', () => {
    const shut = ['editor', 'tabs', 'status']
    expect(stepRegion(shut, 'editor', 1)).toBe('status')
    expect(stepRegion(shut, 'status', 1)).toBe('tabs')
    expect(stepRegion(shut, 'tabs', 1)).toBe('editor')
  })

  test('stays where it is when the note is the whole window', () => {
    expect(stepRegion(['editor'], 'editor', 1)).toBe('editor')
    expect(stepRegion(['editor'], 'editor', -1)).toBe('editor')
  })

  test('and answers nothing at all where there is nothing', () => {
    expect(stepRegion([], null, 1)).toBeNull()
    expect(stepRegion([], 'editor', 1)).toBeNull()
  })

  test('ignores a name it does not know', () => {
    expect(stepRegion(['editor', 'canvas', 'status'], 'editor', 1)).toBe('status')
  })

  test('counts a region once however many times it is drawn', () => {
    expect(stepRegion(['tabs', 'editor', 'tabs', 'editor'], 'tabs', 1)).toBe('editor')
    expect(stepRegion(['tabs', 'editor', 'tabs'], 'editor', 1)).toBe('tabs')
  })
})

describe('the bar under the note', () => {
  test('is drawn over a note, which is what it has something to say about', () => {
    expect(hasStatusBar('note')).toBe(true)
    expect(hasStatusBar('pdf')).toBe(true)
    expect(hasStatusBar('web')).toBe(true)
  })

  test('and left out over the two that have nothing to say', () => {
    expect(hasStatusBar('graph')).toBe(false)
    expect(hasStatusBar('canvas')).toBe(false)
  })

  test('and drawn over a page note, which is where the page counter lives', () => {
    expect(hasStatusBar('pages')).toBe(true)
  })

  test('and stays where nothing is open', () => {
    expect(hasStatusBar(null)).toBe(true)
    expect(hasStatusBar(undefined)).toBe(true)
  })
})
