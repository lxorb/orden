import { type AgentVerb, agentRefusal, registerAgentVerbs } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const asked: { name: string; args: unknown; agent: unknown }[] = []

const ask: AgentVerb = (name, args, caller) => {
  asked.push({ name, args, agent: caller.agent })
  return Promise.resolve(
    name === 'update_task' && (args as { at?: string }).at === 'gone'
      ? agentRefusal('not_found', 'that task is not there')
      : { ok: true, status: 'ok', result: { at: 'Inbox.md#0:abc' } },
  )
}
registerAgentVerbs(() =>
  Promise.resolve(
    Object.fromEntries(
      ['add_task', 'list_tasks', 'update_task', 'query_base'].map((verb) => [verb, ask]),
    ),
  ),
)

const { dispatch, verbForAction } = await import('./verbs')

describe('the to-dos from a terminal and a link', () => {
  test('the command line asks the agent verbs as the reader, with every argument', async () => {
    asked.length = 0
    expect(await dispatch('tasks', { space: 'Shop' }, ['add', 'Milk'])).toEqual({
      ok: true,
      value: { at: 'Inbox.md#0:abc' },
    })
    await dispatch('tasks', { label: 'p1', limit: '5' }, ['list'])
    await dispatch('tasks', {}, ['done', 'Inbox.md#0:abc'])
    await dispatch('base', { view: 'Shelf' }, ['query', 'Books.base'])
    expect(asked).toEqual([
      { name: 'add_task', args: { space: 'Shop', text: 'Milk' }, agent: null },
      { name: 'list_tasks', args: { label: 'p1', limit: '5' }, agent: null },
      { name: 'update_task', args: { at: 'Inbox.md#0:abc', done: true }, agent: null },
      { name: 'query_base', args: { view: 'Shelf', path: 'Books.base' }, agent: null },
    ])
  })

  test('the words after a verb are all its last argument, not only the first', async () => {
    asked.length = 0
    await dispatch('tasks', {}, ['add', 'Call', 'the', 'dentist'])
    await dispatch('base', {}, ['query', 'Reading', 'list.base'])
    expect(asked).toEqual([
      { name: 'add_task', args: { text: 'Call the dentist' }, agent: null },
      { name: 'query_base', args: { path: 'Reading list.base' }, agent: null },
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

  test('orden://add-task adds to an inbox and nowhere else', async () => {
    asked.length = 0
    expect(verbForAction('add-task')).toBe('tasks.add')
    expect(verbForAction('tasks.add')).toBeNull()
    await dispatch(
      'tasks.add',
      { text: 'Call mum', note: 'Diary', under: 'Secrets', space: 'Home' },
      [],
      'link',
    )
    expect(asked).toEqual([
      { name: 'add_task', args: { text: 'Call mum', space: 'Home' }, agent: null },
    ])
  })
})
