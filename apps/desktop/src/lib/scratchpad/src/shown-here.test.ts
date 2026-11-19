import { expect, test, vi } from 'vitest'

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  key: () => null,
  length: 0,
  clear: () => kept.clear(),
})
const { spaceSets, workspace } = await import('../../workspace/src/api')
const { padTab, shown } = await import('./is.svelte')
test.each([false, true])(
  'the scratchpad asked for in one space shows there while another space holds it as a tab, archived: %s (#2256)',
  async (archived) => {
    await spaceSets()
    const a = { id: `a${archived}`, name: 'A', root: `/notes/A${archived}` }
    const b = { id: `b${archived}`, name: 'B', root: `/notes/B${archived}` }
    workspace.spaces = [{ ...a }, { ...b }]
    await workspace.showSpace(a.id)
    shown.on = false
    const pad = workspace.openUnsaved('note', '', 'Scratchpad')
    pad.path = '/app/Scratchpad.md'
    expect(padTab()?.id).toBe(pad.id)
    await workspace.showSpace(b.id)
    if (archived) workspace.archivedSpaces.set(a.root, true)
    const was = workspace.activeTabId
    expect(padTab()).toBe(null)
    shown.show()
    expect(workspace.activeSpaceId).toBe(b.id)
    expect(workspace.activeTabId).toBe(was)
    expect(shown.on).toBe(true)
    expect(workspace.tabs.some((one) => one.id === pad.id)).toBe(true)
    shown.on = false
    const ours = workspace.openUnsaved('note', '', 'Scratchpad')
    ours.path = '/app/Scratchpad.md'
    workspace.openBlank('Plan', '# Plan')
    shown.show()
    expect([workspace.activeSpaceId, workspace.activeTabId, shown.on]).toEqual([b.id, ours.id, false])
  },
)
