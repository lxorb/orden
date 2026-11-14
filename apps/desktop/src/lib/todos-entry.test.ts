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

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return state.tabs
    },
    panes: { activate: (pane: string, tab: string) => state.activated.push([pane, tab]) },
  },
}))
vi.mock('./views/src/api', () => ({
  baseOpening: () => Promise.resolve({ openTodos: (space?: string) => state.opened.push(space) }),
  readSpec: (doc: string) => JSON.parse(doc) as unknown,
}))

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
  test('opens every space’s as a tab where none is open (#1153)', async () => {
    await showTodos()
    expect(state.opened).toEqual([undefined])
    expect(state.activated).toEqual([])
  })

  test('brings forward the tab showing it, in whichever pane it is', async () => {
    state.tabs = [view('a', 'left', {}), view('b', 'right', { builtin: 'todos' })]
    await showTodos()
    expect(state.activated).toEqual([['right', 'b']])
    expect(state.opened).toEqual([])
  })

  test('and the one an older build opened for one space, whatever space is open', async () => {
    state.tabs = [view('b', 'left', { builtin: 'todos', space: 'Home' })]
    await showTodos()
    expect(state.activated).toEqual([['left', 'b']])
    expect(state.opened).toEqual([])
  })
})

describe('where it is asked for', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('not the left side’s head, whose checkbox is gone (#1110)', () => {
    const sidebar = read('./Sidebar.svelte')
    const head = sidebar.slice(
      sidebar.indexOf('<div class="head"'),
      sidebar.indexOf('<div class="switch"'),
    )
    expect(head).not.toContain('todos-entry')
    expect(head).not.toContain('TASKS_MARK')
  })

  test('a double press on a side’s Todos icon, which opens a panel as its tab', () => {
    expect(read('./Sidebar.svelte')).toMatch(/ondblclick=[\s\S]*?import\('\.\/panel-tab'\)/)
    expect(read('./panel-tab.ts')).toMatch(/tasks: \{\s*tab: \(\) => import\('\.\/todos-entry'\)/)
  })

  test('its key, and the palette’s row, which says the key', () => {
    expect(read('./shortcuts/registry.ts')).toMatch(
      /id: 'app\.tasks',[\s\S]*?run: \(\) => void import\('\.\.\/todos-entry'\)/,
    )
    expect(read('./commands.ts')).toMatch(
      /id: 'todos',[\s\S]*?hint: shortcuts\.hint\('app\.tasks'\),[\s\S]*?todos-entry/,
    )
  })
})
