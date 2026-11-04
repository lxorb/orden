import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Todos from the left side's checkbox, its key and the palette (#1047): the space's
 *  one view of its tasks as a tab, brought forward wherever it is open already. */

interface FakeTab {
  id: string
  paneId: string
  kind: string
  path: string | null
  doc: string
}

const state = vi.hoisted(() => ({
  tabs: [] as FakeTab[],
  space: 'Work',
  activated: [] as [string, string][],
  opened: [] as (string | undefined)[],
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return state.tabs
    },
    get activeSpace() {
      return { name: state.space }
    },
    panes: { activate: (pane: string, tab: string) => state.activated.push([pane, tab]) },
  },
}))
vi.mock('./views/open', () => ({
  openTodos: (space?: string) => state.opened.push(space),
}))
vi.mock('./views/spec', () => ({
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
  state.space = 'Work'
  state.activated = []
  state.opened = []
})

describe('Todos, asked for', () => {
  test('opens the open space’s as a tab where none is open', async () => {
    await showTodos()
    expect(state.opened).toEqual(['Work'])
    expect(state.activated).toEqual([])
  })

  test('brings forward the tab showing it, in whichever pane it is', async () => {
    state.tabs = [
      view('a', 'left', { builtin: 'today' }),
      view('b', 'right', { builtin: 'todos', space: 'Work' }),
    ]
    await showTodos()
    expect(state.activated).toEqual([['right', 'b']])
    expect(state.opened).toEqual([])
  })

  test('but not another space’s Todos, which is that space’s', async () => {
    state.tabs = [view('b', 'left', { builtin: 'todos', space: 'Home' })]
    await showTodos()
    expect(state.opened).toEqual(['Work'])
  })

  test('and a Todos tab that names no space is the open space’s', async () => {
    state.tabs = [view('b', 'left', { builtin: 'todos' })]
    await showTodos()
    expect(state.activated).toEqual([['left', 'b']])
  })
})

describe('where it is asked for', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('the checkbox in the left side’s top row', () => {
    const sidebar = read('./Sidebar.svelte')
    const head = sidebar.slice(
      sidebar.indexOf('<div class="head"'),
      sidebar.indexOf('<div class="switch"'),
    )
    expect(head).toMatch(
      /onclick=\{\(\) => void import\('\.\/todos-entry'\)\.then\(\(\{ showTodos \}\) => showTodos\(\)\)\}/,
    )
    expect(head).toContain('<path d={TASKS_MARK} />')
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
