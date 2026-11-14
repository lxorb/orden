import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  dayOf,
  groupedByLabel,
  labelsOf,
  LIMITS,
  MemoryTodoDisk,
  MemoryTodoServer,
  shownTodos,
  SORTS,
  sortedTodos,
  type StoreWorld,
  type Todo,
  TodoStore,
} from '../src/api'

const TODAY = '2026-11-14'

const NOON = Date.parse(`${TODAY}T12:00:00`)

let clock = NOON

function world(server: MemoryTodoServer | null, disks = new Map<string, MemoryTodoDisk>()) {
  const made: StoreWorld = {
    openDisk: async (owner) => {
      const key = owner ?? ''
      const held = disks.get(key) ?? new MemoryTodoDisk()
      disks.set(key, held)
      return held
    },
    now: () => (clock += 1),
    channel: () => null,
    warn: () => undefined,
    later: () => () => undefined,
  }
  const store = new TodoStore(made)
  const open = (owner: string | null) =>
    store.opened({
      owner,
      server: owner === null || server === null ? null : server.forUser(owner),
      device: `${owner ?? 'local'}-${disks.size}`,
    })
  return { store, open, disks }
}

const todo = (over: Partial<Todo>): Todo => ({
  id: over.id ?? 'x',
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

describe('tasks-model contract', () => {
  test('nothing under src reaches the shell: only contracts, sync-core and the held database', () => {
    const src = join(import.meta.dirname, '..', 'src')
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), 'utf8')
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      for (const one of imports) {
        const allowed =
          one.startsWith('./') ||
          one === '@orden/contracts' ||
          one === '@orden/sync-core' ||
          one === '../../held-database'
        expect(allowed, `${name} imports ${one}`).toBe(true)
      }
    }
  })

  test('a new todo lands in the given space by default and with nothing else set', async () => {
    const { store, open } = world(null)
    await open(null)
    const made = await store.add({ title: '  Buy milk ', space: 'home' })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(made.value).toMatchObject({
      title: 'Buy milk',
      space: 'home',
      labels: [],
      start: null,
      deadline: null,
      priority: 0,
      done: false,
      subtasks: [],
    })
    expect(store.todos).toHaveLength(1)
  })

  test('a todo refuses an empty title, a bad day, a priority outside 0 to 3 and too many labels', async () => {
    const { store, open } = world(null)
    await open(null)
    expect((await store.add({ title: '   ' })).ok).toBe(false)
    expect((await store.add({ title: 'x', deadline: '14.11.2026' })).ok).toBe(false)
    expect((await store.add({ title: 'x', priority: 7 as 1 })).ok).toBe(false)
    const many = Array.from({ length: LIMITS.labels + 1 }, (_, i) => `l${i}`)
    expect((await store.add({ title: 'x', labels: many })).ok).toBe(false)
    expect(store.todos).toHaveLength(0)
  })

  test('subtasks hold a title and a done state only, at most the limit, blanks dropped', async () => {
    const { store, open } = world(null)
    await open(null)
    const made = await store.add({ title: 'Trip' })
    if (!made.ok) throw new Error(made.error.message)
    const kept = await store.update(made.value.id, {
      subtasks: [
        { id: 's1', title: 'Book', done: false },
        { id: 's2', title: '   ', done: false },
        { id: 's3', title: 'Pack', done: true },
      ],
    })
    expect(kept.ok && kept.value.subtasks).toEqual([
      { id: 's1', title: 'Book', done: false },
      { id: 's3', title: 'Pack', done: true },
    ])
    const tooMany = Array.from({ length: LIMITS.subtasks + 1 }, (_, i) => ({
      id: `s${i}`,
      title: `step ${i}`,
      done: false,
    }))
    expect((await store.update(made.value.id, { subtasks: tooMany })).ok).toBe(false)
  })

  test('"only this space" keeps the todos of the open space and the ones with no space stay out', () => {
    const all = [
      todo({ id: 'a', space: 'home' }),
      todo({ id: 'b', space: 'work' }),
      todo({ id: 'c', space: null }),
    ]
    const filter = { onlySpace: true, space: 'home', label: null, today: TODAY }
    expect(shownTodos(all, filter).map((t) => t.id)).toEqual(['a'])
    expect(shownTodos(all, { ...filter, onlySpace: false }).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('a label exists only while a shown todo carries it, and within the open space when asked', () => {
    const all = [
      todo({ id: 'a', space: 'home', labels: ['errand', 'Urgent'] }),
      todo({ id: 'b', space: 'work', labels: ['meeting'] }),
      todo({ id: 'c', space: 'work', labels: ['old'], done: true, doneAt: NOON - 86_400_000 * 3 }),
    ]
    expect(labelsOf(all, { onlySpace: false, space: null, today: TODAY })).toEqual([
      'errand',
      'meeting',
      'Urgent',
    ])
    expect(labelsOf(all, { onlySpace: true, space: 'work', today: TODAY })).toEqual(['meeting'])
    expect(
      shownTodos(all, { onlySpace: false, space: null, label: 'meeting', today: TODAY }).map(
        (t) => t.id,
      ),
    ).toEqual(['b'])
  })

  test('a todo with a start date after today stays out of the way until that day', () => {
    const all = [
      todo({ id: 'later', start: '2026-11-15' }),
      todo({ id: 'now', start: '2026-11-14' }),
      todo({ id: 'past', start: '2026-01-01' }),
      todo({ id: 'none' }),
    ]
    const shown = (today: string) =>
      shownTodos(all, { onlySpace: false, space: null, label: null, today }).map((t) => t.id)
    expect(shown(TODAY)).toEqual(['now', 'past', 'none'])
    expect(shown('2026-11-15')).toEqual(['later', 'now', 'past', 'none'])
  })

  test('a done todo stays visible for the rest of its day, then leaves', () => {
    const all = [
      todo({ id: 'today', done: true, doneAt: NOON }),
      todo({ id: 'yesterday', done: true, doneAt: NOON - 86_400_000 }),
      todo({ id: 'open' }),
    ]
    const filter = { onlySpace: false, space: null, label: null, today: dayOf(NOON) }
    expect(shownTodos(all, filter).map((t) => t.id)).toEqual(['today', 'open'])
  })

  test('sorting is exactly deadline, priority and manual, done todos last', () => {
    expect([...SORTS]).toEqual(['deadline', 'priority', 'manual'])
    const all = [
      todo({ id: 'p1d2', priority: 1, deadline: '2026-12-02', order: 3 }),
      todo({ id: 'p3dn', priority: 3, deadline: null, order: 1 }),
      todo({ id: 'p0d1', priority: 0, deadline: '2026-12-01', order: 2 }),
      todo({ id: 'done', priority: 3, deadline: '2026-11-01', order: 0, done: true }),
    ]
    const ids = (sort: (typeof SORTS)[number]) => sortedTodos(all, sort).map((t) => t.id)
    expect(ids('deadline')).toEqual(['p0d1', 'p1d2', 'p3dn', 'done'])
    expect(ids('priority')).toEqual(['p3dn', 'p1d2', 'p0d1', 'done'])
    expect(ids('manual')).toEqual(['p3dn', 'p0d1', 'p1d2', 'done'])
  })

  test('grouping by label puts a todo in every label it carries and the unlabeled last', () => {
    const groups = groupedByLabel([
      todo({ id: 'a', labels: ['work', 'calls'] }),
      todo({ id: 'b', labels: ['calls'] }),
      todo({ id: 'c' }),
    ])
    expect(groups.map((g) => [g.label, g.todos.map((t) => t.id)])).toEqual([
      ['calls', ['a', 'b']],
      ['work', ['a']],
      [null, ['c']],
    ])
  })

  test("two devices of one user see each other's todos, field by field, and a deletion", async () => {
    const server = new MemoryTodoServer()
    const one = world(server)
    const two = world(server)
    await one.open('user-1')
    await two.open('user-1')
    const made = await one.store.add({ title: 'Call Ann', labels: ['calls'] })
    if (!made.ok) throw new Error(made.error.message)
    await one.store.exchange()
    await two.store.exchange()
    expect(two.store.todos.map((t) => t.title)).toEqual(['Call Ann'])

    await one.store.update(made.value.id, { priority: 3 })
    await two.store.update(made.value.id, { deadline: '2026-11-20' })
    await one.store.exchange()
    await two.store.exchange()
    await one.store.exchange()
    expect(one.store.todo(made.value.id)).toMatchObject({ priority: 3, deadline: '2026-11-20' })
    expect(two.store.todo(made.value.id)).toMatchObject({ priority: 3, deadline: '2026-11-20' })

    await two.store.remove(made.value.id)
    await two.store.exchange()
    await one.store.exchange()
    expect(one.store.todos).toHaveLength(0)
  })

  test('todos are per user: another user sees none of them, and signed-out todos are carried into the account', async () => {
    const server = new MemoryTodoServer()
    const alice = world(server)
    await alice.open('alice')
    await alice.store.add({ title: 'Mine' })
    const bob = world(server)
    await bob.open('bob')
    await bob.store.exchange()
    expect(bob.store.todos).toHaveLength(0)

    const guest = world(server)
    await guest.open(null)
    await guest.store.add({ title: 'Before signing in' })
    await guest.open('carol')
    await guest.store.exchange()
    expect(guest.store.todos.map((t) => t.title)).toEqual(['Before signing in'])
    const carol = world(server)
    await carol.open('carol')
    await carol.store.exchange()
    expect(carol.store.todos.map((t) => t.title)).toEqual(['Before signing in'])
  })

  test('what was changed while the server was away goes up on the next exchange', async () => {
    const server = new MemoryTodoServer()
    const one = world(server)
    await one.open('user-2')
    server.down = true
    const made = await one.store.add({ title: 'Offline' })
    expect(made.ok).toBe(true)
    expect(await one.store.exchange()).toBe(false)
    server.down = false
    expect(await one.store.exchange()).toBe(true)
    const two = world(server)
    await two.open('user-2')
    await two.store.exchange()
    expect(two.store.todos.map((t) => t.title)).toEqual(['Offline'])
  })

  test('items of another kind on the same account are not todos', async () => {
    const server = new MemoryTodoServer()
    await server.forUser('user-3').push([
      {
        id: 'old1',
        fields: { text: '- [ ] old inbox line' },
        stamps: { text: '000000001-0000-x' },
      },
    ])
    const one = world(server)
    await one.open('user-3')
    await one.store.exchange()
    expect(one.store.todos).toHaveLength(0)
  })
})
