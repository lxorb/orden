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
  type Panel,
  type PanelSide,
  type Sides,
  STARTS_RIGHT,
  tabsShown,
} from './panels'

const EVERY = ['tree', 'outline', 'search', 'links'] as const

type Some = Sides['panel']
const at = (panel: Some, rightPanel: Some = null, right: Sides['right'] = []): Sides => ({
  panel,
  rightPanel,
  right,
})
const fresh = () => at(null)

describe('which side a panel is on', () => {
  test('is the left unless it was moved, and every one where nothing was', () => {
    expect(sideOf(['outline'], 'tree')).toBe('left')
    expect(sideOf(['outline'], 'outline')).toBe('right')
    for (const panel of EVERY) expect(sideOf([], panel)).toBe('left')
  })
})

describe('which panels a side holds', () => {
  test('the left keeps the app’s own order, less whatever moved over; the right its own', () => {
    expect(panelsOn(['search'], 'left', EVERY)).toEqual(['tree', 'outline', 'links'])
    expect(panelsOn(['search', 'outline'], 'right', EVERY)).toEqual(['search', 'outline'])
  })

  test('and a panel this build has never heard of is on neither', () => {
    expect(panelsOn(['ghost' as never], 'right', EVERY)).toEqual([])
    expect(panelsOn(['ghost' as never], 'left', EVERY)).toEqual(EVERY)
  })
})

describe('showing a panel', () => {
  const both = at('tree', 'search', ['search'])

  test.each<[string, Sides, Panel, Sides]>([
    ['opens it on its own side', fresh(), 'tree', at('tree')],
    [
      'on the right too',
      at('tree', null, ['outline']),
      'outline',
      at('tree', 'outline', ['outline']),
    ],
    ['shuts it where it is already showing', at('tree'), 'tree', fresh()],
    ['leaves the left alone', both, 'search', at('tree', null, ['search'])],
    ['leaves the right alone', both, 'tree', at(null, 'search', ['search'])],
  ])('%s', (_, from, panel, to) => {
    expect(showing(from, panel)).toEqual(to)
  })
})

describe('shutting a side', () => {
  test('closes whichever panel is in it, and leaves what was moved over where it is', () => {
    const both = at('tree', 'search', ['search'])
    expect(closing(both, 'left')).toEqual(at(null, 'search', ['search']))
    expect(closing(both, 'right')).toEqual(at('tree', null, ['search']))
  })
})

describe('moving a panel to the other side', () => {
  test.each<[string, Sides, PanelSide, Sides]>([
    ['takes its open state with it', at('outline'), 'right', at(null, 'outline', ['outline'])],
    ['arrives shut where it was not read', at('tree'), 'right', at('tree', null, ['outline'])],
    ['and back again the same way', at(null, 'outline', ['outline']), 'left', at('outline')],
  ])('%s', (_, from, side, to) => {
    expect(moving(from, 'outline', side)).toEqual(to)
  })

  test('and the last one leaving means a right side with nothing to draw', () => {
    const after = moving(at(null, 'search', ['outline', 'search']), 'outline', 'left')
    expect(after.right).toEqual(['search'])
    expect(moving(after, 'search', 'left')).toMatchObject({ right: [], rightPanel: null })
  })

  test('and moving it where it already is changes nothing at all', () => {
    const over = at(null, 'outline', ['outline'])
    expect(moving(over, 'outline', 'right')).toBe(over)
    expect(moving(fresh(), 'tree', 'left')).toEqual(fresh())
  })
})

describe('what each side shows', () => {
  test('is the panel open on it, or none', () => {
    const both = at('tree', 'search', ['search'])
    expect(openOn(both, 'left')).toBe('tree')
    expect(openOn(both, 'right')).toBe('search')
    expect(openOn(fresh(), 'left')).toBeNull()
    expect(openOn(fresh(), 'right')).toBeNull()
  })
})

describe('the scratchpad over the right side', () => {
  const under: Sides = { ...at('tree', 'outline', ['outline']), covered: true }

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
    expect(moving({ ...at('search'), covered: true }, 'search', 'right')).toEqual({
      ...at(null, 'search', ['search']),
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
    const sides = at(null, 'tasks', ['tasks'])
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
  test.each([
    ['all, where nothing has been laid out yet', 9, 0, 9],
    ['all, where they fit at their narrowest', 6, 172, 6],
    ['all, where there is room to spare', 6, 840, 6],
    ['as many as fit beside More where they do not', 6, 171, 4],
    ['as many as fit beside More, more of them', 9, 172, 5],
    ['never none: the one showing always has a place', 9, 10, 1],
  ])('%s', (_, count, width, shown) => {
    expect(tabsShown(count, width, 26)).toBe(shown)
  })
})

describe('which tabs go behind More', () => {
  const tabs = ['outline', 'links', 'properties', 'footnotes', 'ask', 'agents']
  const split = (fit: number, showing: string) => splitTabs(tabs, fit, (one) => one === showing)

  test('none, where every one is drawn', () => {
    expect(split(6, 'ask')).toEqual({ drawn: tabs, behind: [] })
  })

  test('the last ones, in the strip’s order', () => {
    expect(split(3, 'links')).toEqual({
      drawn: ['outline', 'links', 'properties'],
      behind: ['footnotes', 'ask', 'agents'],
    })
  })

  test('except the one showing, which takes the last place drawn', () => {
    expect(split(3, 'ask')).toEqual({
      drawn: ['outline', 'links', 'ask'],
      behind: ['properties', 'footnotes', 'agents'],
    })
  })
})
