import { beforeEach, describe, expect, test, vi } from 'vitest'

interface World {
  tabs: string[]
  active: string | null
  used: string[]
  held: Map<string, string>
}

const world = vi.hoisted((): World => ({
  tabs: ['a', 'b', 'c'],
  active: 'a',
  used: [],
  held: new Map(),
}))

vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined })

vi.mock('../../platform/src/api', () => ({
  keep: (key: string, value: string) => void world.held.set(key, value),
  storedText: (key: string) => world.held.get(key) ?? null,
}))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabsIn: () => world.tabs.map((id) => ({ id })),
    get activeTabId() {
      return world.active
    },
    activate: (id: string) => (world.active = id),
    panes: {
      focusedId: 'p',
      get used() {
        return world.used
      },
      set used(next: string[]) {
        world.used = next
      },
      lastOf: () => null,
    },
  },
}))

const { cycleTab, tabCycle } = await import('../src/api')

beforeEach(() => {
  world.active = 'a'
  world.used = []
})

describe('stepping through the tabs', () => {
  test('goes along the strip and round the end', () => {
    cycleTab(1)
    expect(world.active).toBe('b')
    cycleTab(-1)
    cycleTab(-1)
    expect(world.active).toBe('c')
  })

  test('comes back to the tabs when none is in front', () => {
    world.active = null
    cycleTab(1)
    expect(world.active).toBe('a')
  })

  test('comes back to the tabs from an essential in front', () => {
    world.active = 'essential'
    cycleTab(-1)
    expect(world.active).toBe('c')
  })

  test('keeps the chosen order', () => {
    tabCycle.setByUse(true)
    expect(tabCycle.byUse).toBe(true)
    expect(world.held.get('orden:tab-order')).toBe('use')
    tabCycle.setByUse(false)
    expect(world.held.get('orden:tab-order')).toBe('strip')
  })
})

describe('stepping in the order the tabs were used', () => {
  test('goes to the tab used last, and remembers the step for the next one', () => {
    tabCycle.setByUse(true)
    world.used = ['c', 'a']

    cycleTab(1, true)
    expect(world.active).toBe('c')
    expect(world.used).toEqual(['c', 'a'])

    cycleTab(1, false)
    expect(world.active).toBe('a')
    tabCycle.setByUse(false)
  })
})
