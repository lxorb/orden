import { agentVerbNames } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
vi.mock('../../tasks-model/src/api', async (actual) => {
  const real = await actual<typeof import('../../tasks-model/src/api')>()
  const disk = new real.MemoryTodoDisk()
  const store = new real.TodoStore({
    openDisk: () => Promise.resolve(disk),
    now: () => Date.now(),
    channel: () => null,
    warn: () => undefined,
    later: () => () => undefined,
  })
  await store.opened({ owner: null, server: null, device: 'test' })
  return { ...real, todos: store }
})
const { readerPort, Refused } = await import('../src/api')
const reader = await readerPort()
describe('the reader port, with no agent verb anywhere', () => {
  test('adds, lists and finishes a todo with the words a link or the command line gives', async () => {
    expect(await agentVerbNames()).toEqual([])
    const added = (await reader.addTask({ text: 'Call mum', deadline: '2026-10-06', priority: '3' })) as {
      id: string
    }
    expect(added).toMatchObject({ title: 'Call mum', deadline: '2026-10-06', priority: 3, done: false })
    expect(await reader.listTasks({})).toMatchObject({ total: 1, todos: [{ id: added.id, title: 'Call mum' }] })
    expect(await reader.updateTask({ at: added.id, done: true })).toMatchObject({ id: added.id, done: true })
    expect(await reader.listTasks({})).toEqual({ total: 0, todos: [] })
    expect(await reader.listTasks({ done: true })).toMatchObject({ total: 1 })
  })
  test('refuses in the words an agent hears', async () => {
    await expect(reader.addTask({})).rejects.toThrow('say text')
    await expect(reader.updateTask({ at: 'nothing', done: true })).rejects.toThrow('there is no todo nothing')
    await expect(reader.addTask({ text: 'x', priority: '7' })).rejects.toThrow('priority is 0, 1, 2 or 3')
    await expect(reader.updateTask({ at: 'nothing' })).rejects.toBeInstanceOf(Refused)
  })
  test('asks for a base only once databases are on, as the agent verb did', async () => {
    await expect(reader.queryBase({ path: 'Books.base' })).rejects.toThrow(
      'databases are turned off; the reader turns it on in Settings, Experimental',
    )
  })
})
