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
const { readViewSpec } = await import('../../tab-kinds/src/api')
const { showTodos } = await import('./todos-entry')
const isTodos = (id: string | null) => {
  const tab = workspace.tabs.find((one) => one.id === id)
  return !!tab && tab.kind === 'view' && readViewSpec(tab.doc)?.builtin === 'todos'
}
test.each([false, true])(
  'Todos asked for in one space opens there while another space holds its board, archived: %s (#2256)',
  async (archived) => {
    await spaceSets()
    const a = { id: `a${archived}`, name: 'A', root: `/notes/A${archived}` }
    const b = { id: `b${archived}`, name: 'B', root: `/notes/B${archived}` }
    workspace.spaces = [{ ...a }, { ...b }]
    await workspace.showSpace(a.id)
    showTodos()
    const there = workspace.activeTabId
    expect(isTodos(there)).toBe(true)
    await workspace.showSpace(b.id)
    if (archived) workspace.archivedSpaces.set(a.root, true)
    showTodos()
    const here = workspace.activeTabId
    expect(workspace.activeSpaceId).toBe(b.id)
    expect(isTodos(here)).toBe(true)
    expect(here).not.toBe(there)
    expect(workspace.tabHere((one) => one.id === here)).not.toBe(null)
    expect(workspace.tabs.some((one) => one.id === there)).toBe(true)
    showTodos()
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([b.id, here])
  },
)
