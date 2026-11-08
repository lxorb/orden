import { afterEach, describe, expect, test, vi } from 'vitest'
import { addingOnce, asking, heard, type Said } from './channel'

describe('what the global window and the app say', () => {
  const task = { text: 'Call mum', fields: { tags: ['family'], remind: [{ before: 15 }] } }

  test('is heard when it is one of ours', () => {
    expect(heard({ kind: 'hello' })).toEqual({ kind: 'hello' })
    expect(heard({ kind: 'task', id: 'a3', entry: task, open: false })).toEqual({
      kind: 'task',
      id: 'a3',
      entry: task,
      open: false,
    })
    expect(heard({ kind: 'added', id: 'a3', ok: false })).toEqual({
      kind: 'added',
      id: 'a3',
      ok: false,
    })
    expect(heard({ kind: 'world', notes: ['Inbox'], lang: 'de', smart: true })?.kind).toBe('world')
  })

  test('and nothing else is', () => {
    expect(heard(null)).toBeNull()
    expect(heard('task')).toBeNull()
    expect(heard({ kind: 'task', id: '1', entry: { text: 1, fields: {} }, open: false })).toBeNull()
    expect(heard({ kind: 'task', entry: task, open: false })).toBeNull()
    expect(heard({ kind: 'added', id: 1, ok: true })).toBeNull()
    expect(
      heard({
        kind: 'task',
        id: '1',
        entry: { ...task, fields: { ...task.fields, priority: 9 } },
        open: true,
      }),
    ).toBeNull()
    expect(heard({ kind: 'world', notes: 'Inbox', lang: 'de', smart: true })).toBeNull()
  })
})

describe('a task the app was slow to answer for', () => {
  const task = { text: 'Call mum', fields: { tags: [], remind: [] } }

  afterEach(() => {
    vi.useRealTimers()
  })

  test('is sent again under the same id, and only that task', async () => {
    vi.useFakeTimers()
    const sent: Said[] = []
    const asked = asking((said) => sent.push(said), 10_000)
    const first = asked.ask(task, false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await first).toBe(false)
    const again = asked.ask(task, false)
    const other = asked.ask({ ...task, text: 'Call dad' }, false)
    const [one, two, three] = sent.map((said) => (said.kind === 'task' ? said.id : ''))
    expect(two).toBe(one)
    expect(three).not.toBe(one)
    asked.heard({ kind: 'added', id: one ?? '', ok: true })
    asked.heard({ kind: 'added', id: three ?? '', ok: true })
    expect(await again).toBe(true)
    expect(await other).toBe(true)
    void asked.ask(task, false)
    expect(sent.at(-1)).toMatchObject({ kind: 'task' })
    expect((sent.at(-1) as { id: string }).id).not.toBe(one)
  })

  test('is added once by the app however often it is asked for', async () => {
    let finish: (ok: boolean) => void = () => undefined
    const add = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    const added = addingOnce(add)
    const first = added('a', task, false)
    const second = added('a', task, false)
    finish(true)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(await added('a', task, false)).toBe(true)
    expect(add).toHaveBeenCalledTimes(1)
  })

  test('is added again when the first try failed', async () => {
    const add = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('disk'))
    add.mockResolvedValue(true)
    const added = addingOnce(add)
    expect(await added('b', task, false)).toBe(false)
    expect(await added('b', task, false)).toBe(false)
    expect(await added('b', task, false)).toBe(true)
    expect(add).toHaveBeenCalledTimes(3)
  })
})
