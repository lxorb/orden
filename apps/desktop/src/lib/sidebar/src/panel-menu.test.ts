import { providePort, registerSidebarPart } from '@orden/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../workspace/src/api', () => ({
  workspace: { movePanel: () => undefined, treeOptions: { showHidden: false } },
}))
providePort('search', {
  panel: {
    running: false,
    hits: [],
    ordering: { sort: 'relevance', descending: false },
    ask: () => undefined,
    setSort: () => undefined,
  },
  show: () => undefined,
  fromView: () => undefined,
})
const { panelMenu } = await import('./panel-menu')
const asked: string[] = []
beforeEach(() => {
  asked.length = 0
})
registerSidebarPart({ id: 'tasks', toTab: async () => void asked.push('todos') })
const asTab = (id: 'tasks' | 'outline' | 'links' | 'tree' | 'search') =>
  panelMenu(id, 'right').find((one) => one !== null && 'label' in one && one.label === 'Open in new tab')
describe('a panel as a tab', () => {
  test('its icon’s menu opens it through its sidebar part, first', async () => {
    const rows = panelMenu('tasks', 'right')
    expect(rows[0]).toMatchObject({ label: 'Open in new tab' })
    ;(rows[0] as { run: () => void }).run()
    await Promise.resolve()
    expect(asked).toEqual(['todos'])
  })
  test('a panel with no part that opens as a tab offers none', () => {
    for (const id of ['outline', 'links', 'tree', 'search'] as const) {
      expect(asTab(id)).toBeUndefined()
    }
  })
  test('the rows a part adds follow its own', () => {
    const rows = panelMenu('time', 'left', [{ label: 'Reminders', run: () => undefined }])
    expect(rows.some((one) => one !== null && 'label' in one && one.label === 'Reminders')).toBe(true)
  })
})
