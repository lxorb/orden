import { describe, expect, test } from 'vitest'
import {
  closing,
  leftPanelFrom,
  mayLiveOn,
  moving,
  openOn,
  PANELS,
  panelsOn,
  rightFrom,
  showing,
  sideOf,
  splitTabs,
  type Sides,
  STARTS_RIGHT,
  tabsShown,
} from './panels'

const EVERY = ['tree', 'outline', 'search', 'links'] as const

function fresh(): Sides {
  return { panel: null, rightPanel: null, right: [] }
}

describe('which side a panel is on', () => {
  test('is the left unless it was moved', () => {
    expect(sideOf([], 'tree')).toBe('left')
    expect(sideOf(['outline'], 'tree')).toBe('left')
    expect(sideOf(['outline'], 'outline')).toBe('right')
  })

  test('and a session with no right side at all reads as all on the left', () => {
    for (const panel of EVERY) expect(sideOf([], panel)).toBe('left')
  })
})

describe('which panels a side holds', () => {
  test('the left keeps the app’s own order, less whatever moved over', () => {
    expect(panelsOn(['search'], 'left', EVERY)).toEqual(['tree', 'outline', 'links'])
  })

  test('the right keeps the order they were moved over in', () => {
    expect(panelsOn(['search', 'outline'], 'right', EVERY)).toEqual(['search', 'outline'])
  })

  test('and a panel this build has never heard of is on neither', () => {
    expect(panelsOn(['ghost' as never], 'right', EVERY)).toEqual([])
    expect(panelsOn(['ghost' as never], 'left', EVERY)).toEqual(EVERY)
  })
})

describe('showing a panel', () => {
  test('opens it on its own side', () => {
    expect(showing(fresh(), 'tree')).toEqual({ panel: 'tree', rightPanel: null, right: [] })

    const moved: Sides = { panel: 'tree', rightPanel: null, right: ['outline'] }
    expect(showing(moved, 'outline')).toEqual({
      panel: 'tree',
      rightPanel: 'outline',
      right: ['outline'],
    })
  })

  test('and shuts it where it is already the one showing', () => {
    const open: Sides = { panel: 'tree', rightPanel: null, right: [] }
    expect(showing(open, 'tree').panel).toBeNull()
  })

  test('and leaves the other side alone either way', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(showing(both, 'search')).toEqual({ panel: 'tree', rightPanel: null, right: ['search'] })
    expect(showing(both, 'tree')).toEqual({ panel: null, rightPanel: 'search', right: ['search'] })
  })
})

describe('shutting a side', () => {
  test('closes whichever panel is in it', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(closing(both, 'left')).toEqual({ panel: null, rightPanel: 'search', right: ['search'] })
    expect(closing(both, 'right')).toEqual({ panel: 'tree', rightPanel: null, right: ['search'] })
  })

  test('and leaves what has been moved over where it is', () => {
    const both: Sides = { panel: null, rightPanel: 'search', right: ['search'] }
    expect(closing(both, 'right').right).toEqual(['search'])
  })
})

describe('moving a panel to the other side', () => {
  test('takes its open state with it', () => {
    const open: Sides = { panel: 'outline', rightPanel: null, right: [] }
    expect(moving(open, 'outline', 'right')).toEqual({
      panel: null,
      rightPanel: 'outline',
      right: ['outline'],
    })
  })

  test('and a panel that was not being read arrives shut', () => {
    const other: Sides = { panel: 'tree', rightPanel: null, right: [] }
    expect(moving(other, 'outline', 'right')).toEqual({
      panel: 'tree',
      rightPanel: null,
      right: ['outline'],
    })
  })

  test('and back again the same way', () => {
    const over: Sides = { panel: null, rightPanel: 'outline', right: ['outline'] }
    expect(moving(over, 'outline', 'left')).toEqual({
      panel: 'outline',
      rightPanel: null,
      right: [],
    })
  })

  test('and the last one leaving means a right side with nothing to draw', () => {
    const two: Sides = { panel: null, rightPanel: 'search', right: ['outline', 'search'] }
    const after = moving(two, 'outline', 'left')
    expect(after.right).toEqual(['search'])

    const one = moving(after, 'search', 'left')
    expect(one.right).toEqual([])
    expect(one.rightPanel).toBeNull()
  })

  test('and moving it where it already is changes nothing at all', () => {
    const over: Sides = { panel: null, rightPanel: 'outline', right: ['outline'] }
    expect(moving(over, 'outline', 'right')).toBe(over)
    expect(moving(fresh(), 'tree', 'left')).toEqual(fresh())
  })
})

describe('what each side shows', () => {
  test('is the panel open on it, or none', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(openOn(both, 'left')).toBe('tree')
    expect(openOn(both, 'right')).toBe('search')
    expect(openOn(fresh(), 'left')).toBeNull()
    expect(openOn(fresh(), 'right')).toBeNull()
  })
})

describe('the scratchpad over the right side', () => {
  const under: Sides = { panel: 'tree', rightPanel: 'outline', right: ['outline'], covered: true }

  test('shows nothing there, and keeps the panel for when the card goes', () => {
    expect(openOn(under, 'right')).toBeNull()
    expect(openOn({ ...under, covered: false }, 'right')).toBe('outline')
    expect(openOn(under, 'left')).toBe('tree')
  })

  test('asking for the panel kept under it shows that panel rather than shutting it', () => {
    expect(showing(under, 'outline')).toEqual({ ...under, covered: false })
  })

  test('asking for another panel on the right shows that one, and the card goes', () => {
    const two: Sides = { ...under, right: ['outline', 'links'] }
    expect(showing(two, 'links')).toEqual({ ...two, rightPanel: 'links', covered: false })
  })

  test('a panel on the left leaves the card where it is', () => {
    expect(showing(under, 'search')).toEqual({ ...under, panel: 'search' })
    expect(closing(under, 'left').covered).toBe(true)
  })

  test('a panel moved over while it is being read takes the edge from the card', () => {
    const reading: Sides = { panel: 'search', rightPanel: null, right: [], covered: true }
    expect(moving(reading, 'search', 'right')).toEqual({
      panel: null,
      rightPanel: 'search',
      right: ['search'],
      covered: false,
    })
    expect(moving(under, 'links', 'right').covered).toBe(true)
  })
})

describe('where a panel lives until somebody moves it', () => {
  test('is the space on the left and the note in front on the right, as Obsidian has it', () => {
    expect(rightFrom(undefined)).toEqual(['outline', 'links', 'ask', 'tasks'])
    expect(panelsOn(rightFrom(undefined), 'left', PANELS)).toEqual([
      'tree',
      'search',
      'chats',
      'time',
    ])
  })

  test('and a window arranged before the homes keeps its own arrangement', () => {
    expect(rightFrom(['outline'])).toEqual(['outline', 'ask', 'tasks'])
    expect(rightFrom(undefined)).toEqual(STARTS_RIGHT)
  })

  test('and Ask is homed on the right in a window that knew every panel before it', () => {
    const before = PANELS.filter((one) => one !== 'ask')
    expect(rightFrom(['links'], before)).toEqual(['links', 'ask', 'tasks'])
    expect(rightFrom([], before)).toEqual(['ask', 'tasks'])
  })

  test('while one that knew every panel is kept exactly, but for the Tasks panel', () => {
    expect(rightFrom([], PANELS)).toEqual(['tasks'])
    expect(rightFrom(['ask'], PANELS)).toEqual(['ask', 'tasks'])
    expect(rightFrom(['tasks', 'ask'], PANELS)).toEqual(['tasks', 'ask'])
  })
})

describe('the Tasks panel', () => {
  test('lives on the right, in a window arranged with it on the left as well', () => {
    expect(panelsOn(rightFrom([], PANELS), 'left', PANELS)).not.toContain('tasks')
    expect(sideOf(rightFrom(['outline'], PANELS), 'tasks')).toBe('right')
  })

  test('and is never moved to the left', () => {
    const sides = { ...fresh(), right: ['tasks' as const], rightPanel: 'tasks' as const }
    expect(moving(sides, 'tasks', 'left')).toBe(sides)
    expect(mayLiveOn('tasks', 'left')).toBe(false)
    expect(mayLiveOn('tasks', 'right')).toBe(true)
    expect(mayLiveOn('tree', 'left')).toBe(true)
  })

  test('so a window left on it on the left opens with that side shut', () => {
    expect(leftPanelFrom('tasks')).toBeNull()
    expect(leftPanelFrom('tree')).toBe('tree')
    expect(leftPanelFrom(undefined)).toBeNull()
  })

  test('and one saved on the left that lives on the right now is not put back on the left', () => {
    expect(leftPanelFrom('outline', ['outline', 'links'])).toBeNull()
    expect(leftPanelFrom('outline', ['links'])).toBe('outline')
  })
})

describe('how many tabs the strip draws', () => {
  test('all of them where nothing has been laid out yet', () => {
    expect(tabsShown(9, 0, 26)).toBe(9)
  })

  test('all of them where they fit at their narrowest', () => {
    expect(tabsShown(6, 172, 26)).toBe(6)
    expect(tabsShown(6, 840, 26)).toBe(6)
  })

  test('and where they do not, as many as fit beside More', () => {
    expect(tabsShown(6, 171, 26)).toBe(4)
    expect(tabsShown(9, 172, 26)).toBe(5)
  })

  test('but never none: the one showing always has a place', () => {
    expect(tabsShown(9, 10, 26)).toBe(1)
  })
})

describe('which tabs go behind More', () => {
  const tabs = ['outline', 'links', 'properties', 'footnotes', 'ask', 'agents']

  test('none, where every one is drawn', () => {
    expect(splitTabs(tabs, 6, (one) => one === 'ask')).toEqual({ drawn: tabs, behind: [] })
  })

  test('the last ones, in the strip’s order', () => {
    expect(splitTabs(tabs, 3, (one) => one === 'links')).toEqual({
      drawn: ['outline', 'links', 'properties'],
      behind: ['footnotes', 'ask', 'agents'],
    })
  })

  test('except the one showing, which takes the last place drawn', () => {
    expect(splitTabs(tabs, 3, (one) => one === 'ask')).toEqual({
      drawn: ['outline', 'links', 'ask'],
      behind: ['properties', 'footnotes', 'agents'],
    })
  })
})
