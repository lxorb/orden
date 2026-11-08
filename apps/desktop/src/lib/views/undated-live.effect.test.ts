import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [],
    activeSpace: undefined,
    tabs: [],
    scheduleSession: () => undefined,
    fileOps: { follow: () => undefined },
  },
}))
vi.mock('../rows/rows.svelte', () => ({ rows: { inboxes: () => [], of: () => [] } }))
vi.mock('../link-index.svelte', () => ({ links: {} }))

const { modes } = await import('../modes.svelte')
const { panelSource, tabSource } = await import('./source')
const { writeSpec } = await import('./spec')

const tab = () => ({
  kind: 'view',
  path: null,
  doc: writeSpec({ builtin: 'todos' }),
  note: { replace: () => undefined },
})

describe('an open Todos or Today and the tasks with no start date (#2017)', () => {
  for (const [name, source] of [
    ['a tab', () => tabSource(tab() as never)],
    ['the tasks panel', () => panelSource({ builtin: 'today' })],
  ] as const) {
    test(`${name} hears the setting flip at once, and no more once stopped`, () => {
      modes.setUndatedInToday(true)
      const heard = vi.fn()
      const stop = source().watch?.(heard)
      flushSync()
      expect(heard).not.toHaveBeenCalled()
      modes.setUndatedInToday(false)
      flushSync()
      expect(heard).toHaveBeenCalledTimes(1)
      stop?.()
      modes.setUndatedInToday(true)
      flushSync()
      expect(heard).toHaveBeenCalledTimes(1)
    })
  }
})
