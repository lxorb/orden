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
const { readSpec } = await import('./spec')
const { openTerm } = await import('./online/open')
const { held } = await import('./remote/held.svelte')
const spaces = (archived: boolean, what: string) => {
  const a = { id: `a${what}${archived}`, name: 'A', root: `/notes/A${what}${archived}` }
  const b = { id: `b${what}${archived}`, name: 'B', root: `/notes/B${what}${archived}` }
  workspace.spaces = [{ ...a }, { ...b }]
  return { a, b }
}
test.each([false, true])(
  'a terminal file asked for in one space opens there while another space holds its tab, archived: %s (#2256)',
  async (archived) => {
    await spaceSets()
    const { a, b } = spaces(archived, 'term')
    const path = `${a.root}/Box.term`
    const pathOf = (id: string | null) => workspace.tabs.find((one) => one.id === id && one.kind === 'terminal')?.path
    await workspace.showSpace(a.id)
    const there = openTerm(path)?.id ?? null
    expect([workspace.activeTabId, pathOf(there)]).toEqual([there, path])
    await workspace.showSpace(b.id)
    if (archived) workspace.archivedSpaces.set(a.root, true)
    const here = openTerm(path)?.id ?? null
    expect(workspace.activeSpaceId).toBe(b.id)
    expect([workspace.activeTabId, pathOf(here)]).toEqual([here, path])
    expect(here).not.toBe(there)
    expect(workspace.tabHere((one) => one.id === here)).not.toBe(null)
    expect(workspace.tabs.some((one) => one.id === there)).toBe(true)
    expect(openTerm(path)?.id).toBe(here)
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([b.id, here])
  },
)
test.each([false, true])(
  'a held session opened in one space comes into it while another space holds its tab, archived: %s (#2256)',
  async (archived) => {
    await spaceSets()
    const { a, b } = spaces(archived, 'held')
    const row = {
      key: `key${archived}`,
      shell: 'bash',
      name: 'Build',
      folder: null,
      host: null,
      program: null,
      last: 0,
      open: false,
      watched: false,
      ended: false,
    }
    const holding = () =>
      workspace.tabs.filter((one) => one.kind === 'terminal' && readSpec(one.doc)?.key === row.key).map((one) => one.id)
    await workspace.showSpace(a.id)
    const tab = held.open(row)
    expect(workspace.activeTabId).toBe(tab)
    await workspace.showSpace(b.id)
    if (archived) workspace.archivedSpaces.set(a.root, true)
    expect(held.open(row)).toBe(tab)
    await vi.waitFor(() => expect(workspace.activeTabId).toBe(tab))
    expect(workspace.activeSpaceId).toBe(b.id)
    expect(workspace.tabHere((one) => one.id === tab)).not.toBe(null)
    expect(holding()).toEqual([tab])
    if (archived) workspace.archivedSpaces.set(a.root, false)
    await workspace.showSpace(a.id)
    expect(workspace.tabHere((one) => one.id === tab)).toBe(null)
  },
)
