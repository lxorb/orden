import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  dayOf,
  followingMoves,
  groupedByLabel,
  labelsOf,
  LIMITS,
  MemoryTodoDisk,
  MemoryTodoServer,
  priorityOf,
  priorityTone,
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
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  repeat: null,
  order: 0,
  created: 0,
  ...over,
})
describe('a repeating todo', () => {
  const opened = async () => {
    const { store, open } = world(null)
    await open(null)
    const add = async (repeat: string, start: string | null, deadline: string | null = null) => {
      const made = await store.add({
        title: 'Pay rent',
        repeat,
        start,
        deadline,
        subtasks: [{ id: 's', title: 'Log in', done: true }],
      })
      if (!made.ok) throw new Error(made.error.message)
      return made.value.id
    }
    const copies = () => store.todos.filter((one) => one.done && one.title === 'Pay rent')
    return { store, add, copies }
  }
  test('done on a fixed day moves to the next date and leaves a done copy behind', async () => {
    const { store, add, copies } = await opened()
    const id = await add('every month on the 1st', null, '2026-11-01')
    const kept = await store.update(id, { done: true })
    expect(kept.ok && kept.value).toMatchObject({
      done: false,
      deadline: '2026-12-01',
      repeat: 'every month on the 1st',
    })
    expect(store.todo(id)?.subtasks).toEqual([{ id: 's', title: 'Log in', done: false }])
    expect(copies()).toHaveLength(1)
    expect(copies()[0]).toMatchObject({ deadline: '2026-11-01', repeat: null, done: true })
    await store.update(id, { done: true })
    expect(store.todo(id)?.deadline).toBe('2027-01-01')
    expect(
      copies()
        .map((one) => one.deadline)
        .sort(),
    ).toEqual(['2026-11-01', '2026-12-01'])
  })
  test('done when it counts from done moves on from today', async () => {
    const { store, add } = await opened()
    const id = await add('every! 10 days', '2026-11-01')
    expect(store.todo(id)?.repeat).toBe('every 10 days when done')
    await store.update(id, { done: true })
    expect(store.todo(id)?.start).toBe('2026-11-24')
  })
  test('undone again goes back to where it was and its done copy goes', async () => {
    const { store, add, copies } = await opened()
    const id = await add('every week', '2026-11-02', '2026-11-04')
    await store.update(id, { done: true })
    expect(copies()).toHaveLength(1)
    await store.update(id, { done: false })
    expect(store.todo(id)).toMatchObject({ start: '2026-11-02', deadline: '2026-11-04', done: false })
    expect(store.todo(id)?.subtasks).toEqual([{ id: 's', title: 'Log in', done: true }])
    expect(copies()).toHaveLength(0)
  })
  test('one with no next date is simply done, and a rule it cannot read is refused', async () => {
    const { store, add, copies } = await opened()
    const id = await add('every day for 1 time', '2026-11-14')
    await store.update(id, { done: true })
    expect(store.todo(id)?.done).toBe(true)
    expect(copies()).toHaveLength(1)
    const bad = await store.add({ title: 'x', repeat: 'now and then' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.message).toBe('repeat is a rule like "every 3 days" or "every! 10 days"')
  })
  test('its rule reaches another device of the user', async () => {
    const server = new MemoryTodoServer()
    const one = world(server)
    const two = world(server)
    await one.open('u')
    await two.open('u')
    const made = await one.store.add({ title: 'Water plants', repeat: 'every 3 days' })
    if (!made.ok) throw new Error(made.error.message)
    await one.store.exchange()
    await two.store.exchange()
    expect(two.store.todo(made.value.id)?.repeat).toBe('every 3 days')
  })
})
describe('tasks-model contract', () => {
  test('every todo link follows its note when the note or its folder moves or comes back, but not a move heard from elsewhere or into another space', async () => {
    const { store, open } = world(null)
    await open(null)
    const follow = followingMoves(store)
    const add = async (description: string) => {
      const made = await store.add({ title: 'Call Sam', description })
      if (!made.ok) throw new Error(made.error.message)
      return () => store.todo(made.value.id)?.description
    }
    const bare = await add('[[Plan]]\n[[Plan#Goals|the plan]]')
    const path = await add('[[Work/Plan]] and [[Work/Other]]')
    const other = await add('[[Plan]] too')
    const moved = (from: string, to: string, more: object = {}) =>
      follow({
        op: 'moved',
        from: `/s/home/${from}`,
        to: `/s/home/${to}`,
        kind: 'file',
        root: '/s/home',
        into: '/s/home',
        ...more,
      })
    await moved('Work/Plan.md', 'Work/Roadmap.md', { heard: true })
    expect(bare()).toBe('[[Plan]]\n[[Plan#Goals|the plan]]')
    await moved('Work/Plan.md', 'Work/Roadmap.md', { into: '/s/work' })
    expect(bare()).toBe('[[Plan]]\n[[Plan#Goals|the plan]]')
    await moved('Work/Plan.md', 'Work/Roadmap.md')
    expect(bare()).toBe('[[Roadmap]]\n[[Roadmap#Goals|the plan]]')
    expect(path()).toBe('[[Work/Roadmap]] and [[Work/Other]]')
    expect(other()).toBe('[[Roadmap]] too')
    await moved('Work', 'Projects', { kind: 'folder' })
    expect(path()).toBe('[[Projects/Roadmap]] and [[Projects/Other]]')
    expect(bare()).toBe('[[Roadmap]]\n[[Roadmap#Goals|the plan]]')
    await moved('Projects', 'Work', { kind: 'folder', heard: true, watched: true })
    await moved('Work/Roadmap.md', 'Work/Plan.md')
    expect(bare()).toBe('[[Plan]]\n[[Plan#Goals|the plan]]')
    expect(path()).toBe('[[Work/Plan]] and [[Work/Other]]')
  })
  test('nothing under src reaches the shell: only contracts, sync-core, the held database and the task line and links of markdown', () => {
    const src = join(import.meta.dirname, '..', 'src')
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), 'utf8')
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      for (const one of imports) {
        const allowed =
          one.startsWith('./') ||
          one === '@orden/contracts' ||
          one === '@orden/sync-core' ||
          one === '../../held-database/src/api' ||
          one === '@orden/markdown/task-line' ||
          one === '@orden/markdown/links'
        expect(allowed, `${name} imports ${one}`).toBe(true)
      }
    }
  })
  test('a new todo has no space and nothing else set, and its record holds no space field', async () => {
    const { store, open, disks } = world(null)
    await open(null)
    const made = await store.add({ title: '  Buy milk ' })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(Object.keys(made.value)).not.toContain('space')
    const record = (await disks.get('')?.items())?.find((one) => one.id === made.value.id)
    expect(Object.keys(record?.fields ?? {})).not.toContain('space')
    expect(made.value).toMatchObject({
      title: 'Buy milk',
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
  test('an old todo record that names a space keeps that field through an update, though the todo has none', async () => {
    const { store, open, disks } = world(null)
    await open(null)
    const made = await store.add({ title: 'Old one' })
    if (!made.ok) throw new Error(made.error.message)
    const disk = disks.get('')
    const held = (await disk?.items())?.find((one) => one.id === made.value.id)
    if (!disk || !held) throw new Error('no record')
    await disk.put([
      {
        ...held,
        fields: { ...held.fields, space: 'home' },
        stamps: { ...held.stamps, space: held.stamps.title ?? '' },
      },
    ])
    const later = world(null, disks)
    await later.open(null)
    expect(Object.keys(later.store.todo(made.value.id) ?? {})).not.toContain('space')
    await later.store.update(made.value.id, { title: 'Old one, renamed' })
    const after = (await disk.items()).find((one) => one.id === made.value.id)
    expect(after?.fields.space).toBe('home')
    expect(after?.fields.title).toBe('Old one, renamed')
  })
  test('a label exists only while a shown todo carries it', () => {
    const all = [
      todo({ id: 'a', labels: ['errand', 'Urgent'] }),
      todo({ id: 'b', labels: ['meeting'] }),
      todo({ id: 'c', labels: ['old'], done: true, doneAt: NOON - 86_400_000 * 3 }),
    ]
    expect(labelsOf(all, { today: TODAY })).toEqual(['errand', 'meeting', 'Urgent'])
    expect(shownTodos(all, { label: 'meeting', today: TODAY }).map((t) => t.id)).toEqual(['b'])
  })
  test('a todo with a start date after today stays out of the way until that day', () => {
    const all = [
      todo({ id: 'later', start: '2026-11-15' }),
      todo({ id: 'now', start: '2026-11-14' }),
      todo({ id: 'past', start: '2026-01-01' }),
      todo({ id: 'none' }),
    ]
    const shown = (today: string) => shownTodos(all, { label: null, today }).map((t) => t.id)
    expect(shown(TODAY)).toEqual(['now', 'past', 'none'])
    expect(shown('2026-11-15')).toEqual(['later', 'now', 'past', 'none'])
  })
  test('a done todo stays out unless done ones are asked for or it is kept a moment, and a start date can be ignored', () => {
    const all = [
      todo({ id: 'today', done: true, doneAt: NOON }),
      todo({ id: 'yesterday', done: true, doneAt: NOON - 86_400_000 }),
      todo({ id: 'open' }),
      todo({ id: 'later', start: '2099-01-01' }),
    ]
    const filter = { label: null, today: dayOf(NOON) }
    expect(shownTodos(all, filter).map((t) => t.id)).toEqual(['open'])
    expect(shownTodos(all, { ...filter, keep: ['today'] }).map((t) => t.id)).toEqual(['today', 'open'])
    expect(shownTodos(all, { ...filter, done: true }).map((t) => t.id)).toEqual(['today', 'yesterday', 'open'])
    expect(shownTodos(all, { ...filter, anyStart: true }).map((t) => t.id)).toEqual(['open', 'later'])
  })
  test('sorting is exactly deadline, priority and manual, done todos last unless kept where they stood', () => {
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
    expect(sortedTodos(all, 'deadline', ['done']).map((t) => t.id)).toEqual(['done', 'p0d1', 'p1d2', 'p3dn'])
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
describe('a priority', () => {
  test('is drawn blue when low, amber when medium, red when high, and plain with none', () => {
    expect([1, 2, 3].map(priorityTone)).toEqual(['var(--callout-note)', 'var(--callout-warning)', 'var(--danger)'])
    expect(priorityTone(0)).toBeUndefined()
    expect(priorityTone(4)).toBeUndefined()
  })
  test('said in a quick add, the first is the highest and none is plain', () => {
    expect(([1, 2, 3, undefined] as const).map((one) => priorityOf(one))).toEqual([3, 2, 1, 0])
  })
})
