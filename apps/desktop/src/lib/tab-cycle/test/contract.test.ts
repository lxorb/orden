import { beforeEach, describe, expect, test, vi } from 'vitest'

interface World {
  tabs: string[]
  active: string | null
  held: Map<string, string>
}

const world = vi.hoisted((): World => ({ tabs: ['a', 'b', 'c'], active: 'a', held: new Map() }))

vi.mock('../../platform/src/api', () => ({
  keep: (key: string, value: string) => void world.held.set(key, value),
  storedText: (key: string) => world.held.get(key) ?? null,
}))

vi.mock('../../panes/src/api', () => ({ Walk: vi.fn() }))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabsIn: () => world.tabs.map((id) => ({ id })),
    get activeTabId() {
      return world.active
    },
    activate: (id: string) => (world.active = id),
    panes: { focusedId: 'p', used: [], lastOf: () => null },
  },
}))

const { cycleTab, tabCycle } = await import('../src/api')

beforeEach(() => {
  world.active = 'a'
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

  test('keeps the chosen order', () => {
    tabCycle.setByUse(true)
    expect(tabCycle.byUse).toBe(true)
    expect(world.held.get('orden:tab-order')).toBe('use')
    tabCycle.setByUse(false)
    expect(world.held.get('orden:tab-order')).toBe('strip')
  })
})
