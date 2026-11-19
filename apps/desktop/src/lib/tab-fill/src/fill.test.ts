import { describe, expect, test, vi } from 'vitest'

const panes = vi.hoisted(() => ({
  fills: null as string | null,
  focusedId: 'p1',
  focused: { activeTabId: 't1' },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: { panes, activeTabId: 't1', activate: () => undefined },
  focusEditor: () => true,
}))
const { fullscreen } = await import('../../ui-kit/src/api')
const { toggleFill } = await import('./fill')
describe('leaving the full window', () => {
  test('in full screen leaves full screen and the full window both', async () => {
    await fullscreen.enter(panes)
    expect(panes.fills).toBe('p1')
    await toggleFill()
    fullscreen.follow()
    expect(fullscreen.on).toBe(false)
    expect(panes.fills).toBeNull()
  })
})
