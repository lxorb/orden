import { beforeEach, describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => [] as string[])

vi.mock('./todos-entry', () => ({ showTodos: () => asked.push('todos') }))
vi.mock('./ai/sidebar/reveal', () => ({ chatToTab: () => asked.push('chat') }))
vi.mock('./scratchpad/pad', () => ({ scratchpad: { asNote: () => asked.push('pad') } }))
vi.mock('./workspace.svelte', () => ({ workspace: { movePanel: () => undefined } }))
vi.mock('./search.svelte', () => ({ search: { ordering: {}, setSort: () => undefined } }))

const { hasTab, openAsTab } = await import('./panel-tab')
const { panelMenu } = await import('./panel-menu')

const settle = () => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  asked.length = 0
})

describe('a panel as a tab', () => {
  test('Todos, Ask and the scratchpad open as theirs', async () => {
    openAsTab('tasks')
    openAsTab('ask')
    openAsTab('scratchpad')
    await settle()
    expect(asked).toEqual(['todos', 'chat', 'pad'])
  })

  test('a panel about the note in front has none, and a double press on it does nothing', async () => {
    for (const id of ['outline', 'links', 'tree', 'search'] as const) {
      expect(hasTab(id)).toBe(false)
      openAsTab(id)
    }
    await settle()
    expect(asked).toEqual([])
  })

  test('its icon’s menu opens it the same way, first', async () => {
    const rows = panelMenu('tasks', 'right')
    expect(rows[0]).toMatchObject({ label: 'Open in new tab' })
    ;(rows[0] as { run: () => void }).run()
    await settle()
    expect(asked).toEqual(['todos'])
    expect(
      panelMenu('outline', 'right').some(
        (one) => one !== null && 'label' in one && one.label === 'Open in new tab',
      ),
    ).toBe(false)
  })
})
