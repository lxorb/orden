import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  tabs: ['a', 'b', 'c'],
  active: 'a',
  used: ['a', 'b', 'c'] as string[],
}))

vi.mock('../../platform/src/api', () => ({
  keep: () => undefined,
  storedText: () => 'use',
}))

vi.mock('../../panes/src/api', async () => ({
  Walk: (await import('../../panes/src/recency')).Walk,
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
      set used(ids: string[]) {
        world.used = ids
      },
      lastOf: () => null,
    },
  },
}))

const { cycleTab } = await import('../src/api')

test('the first Ctrl+Tab walks on while Ctrl stays down, though no key was heard before it', () => {
  cycleTab(1, true, true)
  expect(world.active).toBe('b')
  cycleTab(1, true, true)
  expect(world.active).toBe('c')

  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
  expect(world.used).toEqual(['c', 'a', 'b'])
})
