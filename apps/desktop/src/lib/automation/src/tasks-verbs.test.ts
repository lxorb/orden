import { agentVerbNames, providePort, type ReaderSaid } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
const asked: { name: string; args: unknown }[] = []
const ask = (name: string) => (args: ReaderSaid) => {
  asked.push({ name, args })
  if (name === 'update_task' && args.at === 'gone') return Promise.reject(new Error('that task is not there'))
  return Promise.resolve({ at: 'Inbox.md#0:abc' })
}
providePort('tasks.reader', {
  addTask: ask('add_task'),
  listTasks: ask('list_tasks'),
  updateTask: ask('update_task'),
  queryBase: ask('query_base'),
})
const { dispatch, verbForAction } = await import('./verbs')
describe('the to-dos from a terminal and a link', () => {
  test('the command line asks the reader port, with every argument but a space, and no agent verb is there', async () => {
    asked.length = 0
    expect(await dispatch('tasks', { space: 'Shop' }, ['add', 'Milk'])).toEqual({
      ok: true,
      value: { at: 'Inbox.md#0:abc' },
    })
    await dispatch('tasks', { label: 'p1', limit: '5', space: 'Shop' }, ['list'])
    await dispatch('tasks', { space: 'Shop' }, ['done', 'Inbox.md#0:abc'])
    await dispatch('base', { view: 'Shelf' }, ['query', 'Books.base'])
    expect(await agentVerbNames()).toEqual([])
    expect(asked).toEqual([
      { name: 'add_task', args: { text: 'Milk' } },
      { name: 'list_tasks', args: { label: 'p1', limit: '5' } },
      { name: 'update_task', args: { at: 'Inbox.md#0:abc', done: true } },
      { name: 'query_base', args: { view: 'Shelf', path: 'Books.base' } },
    ])
  })
  test('the words after a verb are all its last argument, not only the first', async () => {
    asked.length = 0
    await dispatch('tasks', {}, ['add', 'Call', 'the', 'dentist'])
    await dispatch('base', {}, ['query', 'Reading', 'list.base'])
    expect(asked).toEqual([
      { name: 'add_task', args: { text: 'Call the dentist' } },
      { name: 'query_base', args: { path: 'Reading list.base' } },
    ])
  })
  test('says it has no filter, view, note or heading rather than leaving one out', async () => {
    asked.length = 0
    const refused = [
      await dispatch('tasks', {}, ['list', 'today & p1']),
      await dispatch('tasks', { view: 'Board' }, ['list']),
      await dispatch('tasks', { note: 'Shop' }, ['add', 'Milk']),
      await dispatch('tasks', { under: 'Later' }, ['add', 'Milk']),
    ]
    expect(refused).toEqual([
      { ok: false, error: 'tasks.list takes no filter' },
      { ok: false, error: 'tasks.list takes no view' },
      { ok: false, error: 'tasks.add takes no note' },
      { ok: false, error: 'tasks.add takes no under' },
    ])
    expect(asked).toEqual([])
  })
  test('says why in a sentence where the verb refused', async () => {
    expect(await dispatch('tasks', {}, ['done', 'gone'])).toEqual({
      ok: false,
      error: 'that task is not there',
    })
  })
  test('orden://add-task adds a todo and nothing else, an old space left out', async () => {
    asked.length = 0
    expect(verbForAction('add-task')).toBe('tasks.add')
    expect(verbForAction('tasks.add')).toBeNull()
    await dispatch('tasks.add', { text: 'Call mum', note: 'Diary', under: 'Secrets', space: 'Home' }, [], 'link')
    expect(asked).toEqual([{ name: 'add_task', args: { text: 'Call mum' } }])
  })
})
