import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Shown, type ShownWorld, SORT_NAMES } from '../src/shown.svelte'

const TODAY = '2026-11-14'

interface Fake {
  id: string
  title: string
  description: string
  labels: string[]
  space: string | null
  start: string | null
  deadline: string | null
  priority: 0 | 1 | 2 | 3
  done: boolean
  doneAt: number | null
  subtasks: never[]
  order: number
  created: number
}

const todo = (over: Partial<Fake>): Fake => ({
  id: 'x',
  title: 'a todo',
  description: '',
  labels: [],
  space: null,
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  order: 0,
  created: 0,
  ...over,
})

function world(list: Fake[], active: string | null = 'home') {
  let kept: unknown = undefined
  const made: ShownWorld = {
    todos: () => list,
    activeSpace: () => (active === null ? null : { id: active, name: `Space ${active}` }),
    spaces: () => [
      { id: 'home', name: 'Space home' },
      { id: 'work', name: 'Space work' },
    ],
    today: () => TODAY,
    kept: () => kept,
    keep: (value) => (kept = value),
  }
  return { world: made, read: () => kept }
}

describe('tasks-views contract', () => {
  test('the module reads the model only through its api and nothing from the shell', () => {
    const src = join(import.meta.dirname, '..', 'src')
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), 'utf8')
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      for (const one of imports) {
        const allowed =
          one.startsWith('./') ||
          one === 'svelte' ||
          one === '@orden/contracts' ||
          one === '../../tasks-model/src/api'
        expect(allowed, `${name} imports ${one}`).toBe(true)
      }
    }
  })

  test('the window offers exactly deadline, priority and manual sorting, deadline by default', () => {
    const { world: w } = world([])
    const shown = new Shown(w)
    expect(Object.keys(SORT_NAMES)).toEqual(['deadline', 'priority', 'manual'])
    expect(shown.sort).toBe('deadline')
  })

  test('"only this space" and the sort are kept between openings, the label is not', () => {
    const { world: w, read } = world([todo({ id: 'a', labels: ['x'] })])
    const first = new Shown(w)
    first.setOnlySpace(true)
    first.setSort('manual')
    first.setLabel('x')
    expect(read()).toEqual({ onlySpace: true, sort: 'manual' })
    const second = new Shown(w)
    expect(second.onlySpace).toBe(true)
    expect(second.sort).toBe('manual')
    expect(second.label).toBeNull()
  })

  test('the label dropdown lists only labels carried by shown todos, within the space when asked', () => {
    const { world: w } = world([
      todo({ id: 'a', space: 'home', labels: ['errand'] }),
      todo({ id: 'b', space: 'work', labels: ['meeting'] }),
      todo({ id: 'c', space: 'home', labels: ['later'], start: '2026-12-01' }),
    ])
    const shown = new Shown(w)
    expect(shown.labels).toEqual(['errand', 'later', 'meeting'])
    shown.setOnlySpace(true)
    expect(shown.labels).toEqual(['errand', 'later'])
    expect(shown.todos.map((t) => t.id)).toEqual(['a'])
  })

  test('a chosen label that no todo carries any more falls back to all labels', () => {
    const list = [todo({ id: 'a', labels: ['x'] }), todo({ id: 'b' })]
    const { world: w } = world(list)
    const shown = new Shown(w)
    shown.setLabel('x')
    expect(shown.todos.map((t) => t.id)).toEqual(['a'])
    list.shift()
    expect(shown.filter.label).toBeNull()
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
  })

  test('the board groups by label with the unlabeled column last and follows the sort', () => {
    const { world: w } = world([
      todo({ id: 'a', labels: ['work'], deadline: '2026-11-20', order: 2 }),
      todo({ id: 'b', labels: ['work'], deadline: '2026-11-16', order: 1 }),
      todo({ id: 'c', order: 0 }),
    ])
    const shown = new Shown(w)
    expect(shown.groups.map((g) => [g.label, g.todos.map((t) => t.id)])).toEqual([
      ['work', ['b', 'a']],
      [null, ['c']],
    ])
    shown.setSort('manual')
    expect(shown.groups[0]?.todos.map((t) => t.id)).toEqual(['b', 'a'])
  })

  test('with no open space the space filter cannot narrow anything', () => {
    const { world: w } = world([todo({ id: 'a', space: 'home' }), todo({ id: 'b' })], null)
    const shown = new Shown(w)
    shown.setOnlySpace(true)
    expect(shown.space).toBeNull()
    expect(shown.spaceName('work')).toBe('Space work')
    expect(shown.todos.map((t) => t.id)).toEqual(['b'])
  })
})
