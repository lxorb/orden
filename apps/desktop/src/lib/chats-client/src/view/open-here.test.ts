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
const { spaceSets, workspace } = await import('../../../workspace/src/api')
const { EXPERIMENTAL_WORD, CHATS_WORD, hiddenKinds } = await import('../../../gates/src/api')
const { openChat } = await import('./open')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
const chatOf = (id: string | null) => workspace.tabs.find((one) => one.id === id && one.kind === 'channel')?.path
test.each([false, true])(
  'a chat asked for in one space opens there while another space holds its tab, archived: %s (#2256)',
  async (archived) => {
    await spaceSets()
    const a = { id: `a${archived}`, name: 'A', root: `/notes/A${archived}` }
    const b = { id: `b${archived}`, name: 'B', root: `/notes/B${archived}` }
    const path = `${a.root}/Team.chat`
    workspace.spaces = [{ ...a }, { ...b }]
    await workspace.showSpace(a.id)
    openChat(path)
    const there = workspace.activeTabId
    expect(chatOf(there)).toBe(path)
    await workspace.showSpace(b.id)
    if (archived) workspace.archivedSpaces.set(a.root, true)
    openChat(path)
    const here = workspace.activeTabId
    expect(workspace.activeSpaceId).toBe(b.id)
    expect(chatOf(here)).toBe(path)
    expect(here).not.toBe(there)
    expect(workspace.tabHere((one) => one.id === here)).not.toBe(null)
    expect(workspace.tabs.some((one) => one.id === there)).toBe(true)
    openChat(path)
    expect([workspace.activeSpaceId, workspace.activeTabId]).toEqual([b.id, here])
  },
)
