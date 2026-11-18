import { inboxStamp } from '@orden/sync-core'
import { expect, test } from 'vitest'
import { MemoryTodoDisk, MemoryTodoServer, type StoreWorld, TodoStore } from '../src/api'

const NOON = Date.parse('2026-11-14T12:00:00')

function device(server: MemoryTodoServer, owner: string, now: () => number) {
  const world: StoreWorld = {
    openDisk: () => Promise.resolve(new MemoryTodoDisk()),
    now,
    channel: () => null,
    warn: () => undefined,
    later: () => () => undefined,
  }
  const store = new TodoStore(world)
  return {
    store,
    open: () => store.opened({ owner, server: server.forUser(owner), device: 'laptop' }),
  }
}

test('a todo changed on a device whose clock is behind keeps the change over one stamped later by the account', async () => {
  const server = new MemoryTodoServer()
  const ahead = NOON + 5 * 60_000
  const stamp = inboxStamp(ahead, 0, 'mcp')
  await server.forUser('u').push([
    {
      id: 'tclaude',
      fields: { kind: 'todo', title: 'Call Ann', done: false, priority: 0 },
      stamps: { kind: stamp, title: stamp, done: stamp, priority: stamp },
    },
  ])
  let clock = NOON
  const laptop = device(server, 'u', () => (clock += 1))
  await laptop.open()
  await laptop.store.exchange()
  expect(laptop.store.todo('tclaude')?.done).toBe(false)

  const ticked = await laptop.store.update('tclaude', { done: true, priority: 3 })
  expect(ticked.ok && ticked.value).toMatchObject({ done: true, priority: 3 })
  await laptop.store.exchange()

  let other = NOON
  const phone = device(server, 'u', () => (other += 1))
  await phone.open()
  await phone.store.exchange()
  expect(phone.store.todo('tclaude')).toMatchObject({ done: true, priority: 3 })
})

test('a todo changed over a stamp from a clock far ahead does not carry that clock into the stamps of other todos', async () => {
  const server = new MemoryTodoServer()
  const ahead = inboxStamp(NOON + 365 * 86_400_000, 0, 'other')
  await server.forUser('u').push([
    {
      id: 'tahead',
      fields: { kind: 'todo', title: 'From the future', done: false },
      stamps: { kind: ahead, title: ahead, done: ahead },
    },
  ])
  let clock = NOON
  const laptop = device(server, 'u', () => (clock += 1))
  await laptop.open()
  await laptop.store.exchange()
  await laptop.store.update('tahead', { done: true })
  const made = await laptop.store.add({ title: 'Today' })
  if (!made.ok) throw new Error(made.error.message)
  await laptop.store.exchange()
  const stampOf = (id: string, key: string) =>
    server
      .forUser('u')
      .pull(0)
      .then((page) => page?.items.find((one) => one.id === id)?.stamps[key] ?? '')
  expect(await stampOf('tahead', 'done')).not.toBe(ahead)
  expect((await stampOf(made.value.id, 'title')) < ahead).toBe(true)
})

test('a todo too long for one change to the account is refused instead of staying on this device only, and one that fits reaches the other device', async () => {
  const server = new MemoryTodoServer()
  let clock = NOON
  const laptop = device(server, 'u', () => (clock += 1))
  await laptop.open()
  const long = await laptop.store.add({ title: 'Trip', description: 'ü'.repeat(8000) })
  expect(long.ok).toBe(false)
  const made = await laptop.store.add({ title: 'Trip', description: 'u'.repeat(8000) })
  if (!made.ok) throw new Error(made.error.message)
  const subtasks = Array.from({ length: 50 }, (_, at) => ({
    id: `s${at}`,
    title: 'step "quoted" '.repeat(30),
    done: false,
  }))
  expect((await laptop.store.update(made.value.id, { subtasks })).ok).toBe(false)
  await laptop.store.exchange()
  let other = NOON
  const phone = device(server, 'u', () => (other += 1))
  await phone.open()
  await phone.store.exchange()
  expect(phone.store.todos.map((one) => one.description.length)).toEqual([8000])
})
