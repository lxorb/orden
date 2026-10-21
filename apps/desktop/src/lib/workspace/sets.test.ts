import { describe, expect, test } from 'vitest'
import { type Frame, pane, panesIn } from './pane-tree'
import {
  focusIn,
  GLOBAL,
  isHiddenTabs,
  onLeaving,
  ownerOf,
  readSets,
  setKey,
  sharedGoesTo,
  tidied,
} from './sets'

/** A space's own tabs, decided: which set a space shows, what a set out of sight is
 *  written down as, and what a frame is once its tabs have changed out of sight. */

describe('which set a space shows', () => {
  test('its own, every space', () => {
    expect(setKey('work')).toBe('work')
    expect(setKey('home')).toBe('home')
  })

  test("the window's own where there is no space at all", () => {
    expect(setKey(null)).toBe(GLOBAL)
  })
})

/** Before #674 a space chose: Global, sharing one set, or its own. The shared set
 *  becomes one space's, once, so nobody loses a tab. */
describe('where the set every Global space shared goes', () => {
  const spaces = ['work', 'home', 'uni']

  test('to the first space that shared it and has no set of its own yet', () => {
    expect(sharedGoesTo(spaces, new Set(['work']), () => false)).toBe('home')
    expect(sharedGoesTo(spaces, new Set(), (one) => one === 'work')).toBe('home')
  })

  test('nowhere where every space has a set of its own', () => {
    expect(sharedGoesTo(spaces, new Set(['work', 'home']), (one) => one === 'uni')).toBeNull()
  })
})

describe('what leaving a set does with its pages', () => {
  test('nothing at all where nothing is running, whatever was chosen', () => {
    expect(onLeaving('ask', 0)).toBe('run')
    expect(onLeaving('pause', 0)).toBe('run')
  })

  test('what was chosen where something runs, the question until somebody answers', () => {
    expect(onLeaving('ask', 2)).toBe('ask')
    expect(onLeaving('pause', 1)).toBe('pause')
    expect(onLeaving('run', 1)).toBe('run')
  })

  test('only the three answers are answers', () => {
    expect(['run', 'pause', 'ask'].every(isHiddenTabs)).toBe(true)
    expect(isHiddenTabs('keep')).toBe(false)
    expect(isHiddenTabs(null)).toBe(false)
  })
})

describe('which space a tab belongs to', () => {
  const spaces = [
    { id: 'work', root: '/spaces/Work' },
    { id: 'home', root: '/spaces/Home' },
  ]

  test('the space its file is in', () => {
    expect(ownerOf('/spaces/Home/Lists/Food.md', null, spaces)).toBe('home')
  })

  test('for a tab with no file, the space it was opened in', () => {
    expect(ownerOf(null, 'work', spaces)).toBe('work')
  })

  test('none for a file outside every space, or a tab of nowhere', () => {
    expect(ownerOf('/elsewhere/Note.md', null, spaces)).toBeNull()
    expect(ownerOf(null, null, spaces)).toBeNull()
  })

  test('a folder whose name starts like another is not inside it', () => {
    expect(ownerOf('/spaces/Workshop/Note.md', null, spaces)).toBeNull()
  })
})

describe('a frame put right after its tabs changed out of sight', () => {
  /** Two panes side by side, the left showing `a`. */
  function two(): Frame {
    return {
      kind: 'split',
      id: 's',
      along: 'row',
      fraction: 0.5,
      sides: [pane('left', 'a'), pane('right', 'c')],
    }
  }

  test('a pane whose tabs all went gives its room to the other', () => {
    const strips: Record<string, string[]> = { left: ['a', 'b'], right: [] }
    const frame = tidied(
      two(),
      (id) => strips[id] ?? [],
      () => null,
    )
    expect(panesIn(frame).map((one) => one.id)).toEqual(['left'])
  })

  test('the last pane stays, empty, as a window keeps one', () => {
    const frame = tidied(
      pane('only', 'gone'),
      () => [],
      () => null,
    )
    expect(frame).toMatchObject({ kind: 'pane', id: 'only', activeTabId: null })
  })

  test('a pane whose tab in front went shows the one in front last, else its first', () => {
    const strips: Record<string, string[]> = { left: ['b', 'x'], right: ['c', 'd'] }
    const lastUsed = (strip: readonly string[]) => (strip.includes('x') ? 'x' : null)
    const [left, right] = panesIn(tidied(two(), (id) => strips[id] ?? [], lastUsed))
    expect(left?.activeTabId).toBe('x')
    expect(right?.activeTabId).toBe('c')

    const [first] = panesIn(
      tidied(
        two(),
        (id) => strips[id] ?? [],
        () => null,
      ),
    )
    expect(first?.activeTabId).toBe('b')
  })

  /** Ctrl+D showed nothing in that pane as the set was left, and it comes back so. */
  test('a pane put down stays down while it still has tabs', () => {
    const frame: Frame = {
      kind: 'split',
      id: 's',
      along: 'row',
      fraction: 0.5,
      sides: [pane('left', null), pane('right', 'c')],
    }
    const strips: Record<string, string[]> = { left: ['a', 'b'], right: ['c'] }
    const [left, right] = panesIn(
      tidied(
        frame,
        (id) => strips[id] ?? [],
        () => 'b',
      ),
    )
    expect(left?.activeTabId).toBeNull()
    expect(right?.activeTabId).toBe('c')
  })

  test('the focus stays where its pane still is, and goes to the first where it went', () => {
    const frame = two()
    expect(focusIn(frame, 'right')).toBe('right')
    expect(focusIn(frame, 'gone')).toBe('left')
  })
})

describe('the sets as the session writes them', () => {
  const layout = {
    frame: { kind: 'pane', pane: { id: 'p', tabs: [], active: 0, linked: false } },
    focused: 'p',
    panel: 'outline',
  }

  test('the set on screen and each set put aside, with its right side', () => {
    const read = readSets({ on: 'work', aside: { global: { layout, right: 'links' } } })
    expect(read?.on).toBe('work')
    expect(read?.aside.global?.right).toBe('links')
    expect(read?.aside.global?.layout.panel).toBe('outline')
  })

  test('a set that does not read as one costs that set and nothing else', () => {
    const read = readSets({
      on: 'global',
      aside: { work: { layout: 'nonsense' }, home: { layout, right: 'nothing' } },
    })
    expect(Object.keys(read?.aside ?? {})).toEqual(['home'])
    expect(read?.aside.home?.right).toBeNull()
  })

  test('nothing at all for what is not the shape', () => {
    expect(readSets(undefined)).toBeNull()
    expect(readSets({ aside: {} })).toBeNull()
    expect(readSets({ on: 'global', aside: [] })).toBeNull()
  })
})
