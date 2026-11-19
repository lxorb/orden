import { describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../../workspace/src/api')
const { isOwnPage } = await import('@orden/scan/own-pages')
const { openHistory } = await import('./history-open')
const A = { id: 'a', name: 'A', root: '/notes/A' }
const B = { id: 'b', name: 'B', root: '/notes/B' }
const history = () => workspace.tabs.filter((one) => one.kind === 'web' && isOwnPage(one.address ?? ''))
describe('History asked for in one space while another holds it', () => {
  for (const archived of [false, true]) {
    test(`opens here and leaves the other's alone${archived ? ', that space archived' : ''}`, async () => {
      workspace.tabs = []
      workspace.spaces = [{ ...A }, { ...B }]
      workspace.archivedSpaces.set(A.root, false)
      await workspace.showSpace(A.id)
      workspace.openBlank('In A', '# A')
      openHistory()
      const there = workspace.activeTabId
      expect(history().map((one) => one.id)).toEqual([there])
      await workspace.showSpace(B.id)
      workspace.openBlank('In B', '# B')
      if (archived) workspace.archivedSpaces.set(A.root, true)
      openHistory()
      await new Promise((done) => setTimeout(done))
      expect(workspace.activeSpaceId).toBe(B.id)
      const here = workspace.active
      expect(here?.kind).toBe('web')
      expect(isOwnPage(here?.address ?? '')).toBe(true)
      expect(here?.id).not.toBe(there)
      expect(history().map((one) => one.id)).toEqual(expect.arrayContaining([there, here?.id]))
    })
  }
})
