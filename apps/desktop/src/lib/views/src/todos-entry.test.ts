import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

interface FakeTab {
  id: string
  paneId: string
  kind: string
  path: string | null
  doc: string
}

const state = vi.hoisted(() => ({
  tabs: [] as FakeTab[],
  activated: [] as [string, string][],
  opened: [] as (string | undefined)[],
}))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get tabs() {
      return state.tabs
    },
    panes: { activate: (pane: string, tab: string) => state.activated.push([pane, tab]) },
  },
}))
vi.mock('./open', () => ({ openTodos: (space?: string) => state.opened.push(space) }))

const { showTodos } = await import('./todos-entry')

const view = (id: string, paneId: string, spec: object): FakeTab => ({
  id,
  paneId,
  kind: 'view',
  path: null,
  doc: JSON.stringify(spec),
})

beforeEach(() => {
  state.tabs = []
  state.activated = []
  state.opened = []
})

describe('Todos, asked for', () => {
  test('opens every space’s as a tab where none is open (#1153)', () => {
    showTodos()
    expect(state.opened).toEqual([undefined])
    expect(state.activated).toEqual([])
  })

  test('brings forward the tab showing it, in whichever pane it is', () => {
    state.tabs = [view('a', 'left', {}), view('b', 'right', { builtin: 'todos' })]
    showTodos()
    expect(state.activated).toEqual([['right', 'b']])
    expect(state.opened).toEqual([])
  })

  test('and the one an older build opened for one space, whatever space is open', () => {
    state.tabs = [view('b', 'left', { builtin: 'todos', space: 'Home' })]
    showTodos()
    expect(state.activated).toEqual([['left', 'b']])
    expect(state.opened).toEqual([])
  })
})

describe('where it is asked for', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('not the left side’s head, whose checkbox is gone (#1110)', () => {
    const sidebar = read('../../sidebar/src/Sidebar.svelte')
    const head = sidebar.slice(
      sidebar.indexOf('<div class="head"'),
      sidebar.indexOf('<div class="switch"'),
    )
    expect(head).not.toContain('views.todos')
    expect(head).not.toContain('TASKS_MARK')
  })

  test('a double press on a side’s Todos icon, which opens a panel as its tab', () => {
    expect(read('../../sidebar/src/Sidebar.svelte')).toMatch(
      /ondblclick=[\s\S]*?sidebarPart\(id\)\?\.toTab\?\.\(\)/,
    )
    expect(read('../../features.ts')).toMatch(
      /registerSidebarPart\(\{ id: 'tasks', toTab: \(\) => runCommand\('views\.todos'\)/,
    )
  })

  test('its key, and the palette’s row, which says the key', () => {
    expect(read('../../shortcuts/src/registry.ts')).toMatch(
      /id: 'app\.tasks',[\s\S]*?run: \(\) => void runCommand\('views\.todos'\)/,
    )
    expect(read('../../commands/src/commands.ts')).toMatch(
      /id: 'todos',[\s\S]*?hint: shortcuts\.hint\('app\.tasks'\),[\s\S]*?views\.todos/,
    )
  })
})
