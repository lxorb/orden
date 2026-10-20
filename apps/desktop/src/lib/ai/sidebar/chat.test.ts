/** The AI panel's chats are one list, every space's (#332): a space changing keeps the
 *  open chat, its draft and its place, and the chats each space had are all in the list.
 *  The crate's per-space store is played here by a map, so what is kept where is seen. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Draft, EngineEvent, Thread } from '../chat/types'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

/** The crate's threads, by space and id: the head the list shows and the body. */
const kept = vi.hoisted(() => new Map<string, Map<string, { head: unknown; body: string }>>())
const deleted = vi.hoisted(() => [] as string[])

vi.mock('../../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tauri')>()),
  isNative: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    const space = String(args.space)
    const shelf = kept.get(space) ?? new Map<string, { head: unknown; body: string }>()
    kept.set(space, shelf)
    if (command === 'ai_threads_list')
      return Promise.resolve([...shelf.values()].map((one) => one.head))
    if (command === 'ai_thread_read')
      return Promise.resolve(shelf.get(String(args.id))?.body ?? null)
    if (command === 'ai_thread_write') {
      shelf.set(String(args.id), { head: args.head, body: String(args.body) })
      return Promise.resolve(null)
    }
    if (command === 'ai_thread_delete') {
      shelf.delete(String(args.id))
      deleted.push(`${space}/${String(args.id)}`)
      return Promise.resolve(null)
    }
    return Promise.resolve(null)
  },
}))

const place = vi.hoisted(() => ({
  spaces: [
    { id: 'work', name: 'Work', root: '/notes/Work' },
    { id: 'home', name: 'Home', root: '/notes/Home' },
  ],
  activeSpaceId: 'work',
}))

vi.mock('../../workspace.svelte', () => ({ workspace: place }))

vi.mock('../store.svelte', () => {
  const provider = { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' }
  return { ai: { providerFor: () => provider, provider: () => provider } }
})

/** The engine, which answers every send at the plan's limit, until an hour from now. */
const until = vi.hoisted(() => Date.now() + 3_600_000)
const engine = vi.hoisted(() => ({
  models: () => Promise.resolve([]),
  send: vi.fn((thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
    const notice = { kind: 'notice', code: 'error', text: 'At its limit' } as const
    thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
    thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [notice] })
    on({ type: 'limit', limit: { state: 'reached', until, untilWords: null } })
    on({ type: 'done', stop: 'error', error: notice.text })
    return Promise.resolve()
  }),
}))
vi.mock('./setup', () => ({ engineOf: () => Promise.resolve(engine) }))

// What a review of an agent's edits needs is a workspace of documents, which none of
// this is about.
vi.mock('../review', () => ({
  editMessage: () => null,
  lastMessage: () => null,
  openRewind: () => null,
}))

vi.mock('../../prompt.svelte', () => ({ prompt: { confirm: () => Promise.resolve(true) } }))

/** The panel as a launch finds it: its store and what it remembers read afresh. */
async function launched() {
  vi.resetModules()
  return (await import('./chat.svelte')).chat
}

/** A thread with one message in it, kept in `space`. */
async function had(space: string, title: string, updated: number) {
  const { keepThread, newThread } = await import('../chat/threads')
  const thread = newThread(space, 'p', 'm')
  thread.title = title
  thread.turns = [{ id: `${title}-1`, role: 'you', at: updated, parts: [] }]
  thread.updated = updated
  await keepThread(thread)
  return thread
}

describe('the panel’s chats', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
  })

  test('are one list of every space’s, newest first, each still kept where it was asked', async () => {
    await had('work', 'Quarterly plan', 1_000)
    await had('home', 'Garden', 3_000)
    await had('home', 'Recipes', 2_000)
    // What a space kept the thread it had open as, before the list was one.
    localStorage.setItem('nib:ai-sidebar', JSON.stringify({ open: { home: 'none-left' } }))

    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await vi.waitFor(() => expect(chat.heads).toHaveLength(3))

    expect(chat.heads.map((one) => [one.title, one.space])).toEqual([
      ['Garden', 'home'],
      ['Recipes', 'home'],
      ['Quarterly plan', 'work'],
    ])
    // The newest of them is open, though the space in front is another.
    await vi.waitFor(() => expect(chat.head?.title).toBe('Garden'))
  })

  test('stay as they are when the space changes: the open one, its draft, its space', async () => {
    const plan = await had('work', 'Quarterly plan', 5_000)
    await had('home', 'Garden', 4_000)
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await chat.openThread(plan.id, false)
    chat.text = 'and the budget for'

    chat.here('home')
    chat.know(['work', 'home'])

    expect(chat.head?.id).toBe(plan.id)
    expect(chat.text).toBe('and the budget for')
    expect(chat.thread?.space).toBe('work')
    await vi.waitFor(() =>
      expect(chat.heads.map((one) => one.title)).toEqual(['Quarterly plan', 'Garden']),
    )
    expect(chat.head?.id).toBe(plan.id)
  })

  test('start a new one in the space in front, and an empty one follows the reader', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    chat.newThread()
    expect(chat.thread?.space).toBe('work')

    chat.here('home')
    expect(chat.thread?.space).toBe('home')
  })

  test('open the one open last, whichever space it is in', async () => {
    const garden = await had('home', 'Garden', 1_000)
    await had('work', 'Quarterly plan', 9_000)
    localStorage.setItem('nib:ai-sidebar', JSON.stringify({ last: garden.id }))
    const fresh = await launched()

    fresh.here('work')
    fresh.know(['work', 'home'])
    await vi.waitFor(() => expect(fresh.head?.id).toBe(garden.id))
  })

  test('delete a thread from the space it is kept in', async () => {
    const garden = await had('home', 'Garden', 1_000)
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home', 'more'])
    await vi.waitFor(() => expect(chat.heads.some((one) => one.id === garden.id)).toBe(true))

    await chat.remove(garden.id)

    expect(deleted).toEqual([`home/${garden.id}`])
    expect(chat.heads.some((one) => one.id === garden.id)).toBe(false)
  })

  test('take a task done with AI as one more, sent in its mode while the open one stays', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    const open = chat.thread
    void chat.startAside('home', 'Book the dentist', 'auto', 'Do this task')

    const task = chat.threadOf(chat.running[0] ?? '')
    expect([task?.space, task?.title, task?.mode]).toEqual(['home', 'Book the dentist', 'auto'])
    expect(chat.pending[task?.id ?? '']).toBe('Do this task')
    expect(chat.thread).toBe(open)
    await vi.waitFor(() => expect(chat.heads.map((one) => one.title)).toEqual(['Book the dentist']))
  })

  test('at the plan’s limit, send the message again once it resets, in another chat too', async () => {
    engine.send.mockClear()
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    chat.text = 'go on'
    chat.submit({ front: null, selection: '' })
    const asked = chat.thread
    await vi.waitFor(() =>
      expect(chat.resets[String(asked?.id)]).toEqual({ until, waiting: false }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    chat.waitForReset(true)
    chat.newThread()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(engine.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(2))
    expect(engine.send.mock.calls[1]?.slice(0, 2)).toEqual([
      asked,
      { text: 'go on', attachments: [] },
    ])
  })

  test('wait no longer for the plan to reset once the wait is taken back', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    engine.send.mockClear()
    chat.text = 'go on'
    chat.submit({ front: null, selection: '' })
    await vi.waitFor(() => expect(chat.resets[String(chat.thread?.id)]?.waiting).toBe(false))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    chat.waitForReset(true)
    chat.waitForReset(false)
    await vi.advanceTimersByTimeAsync(7_200_000)
    vi.useRealTimers()
    expect(engine.send).toHaveBeenCalledTimes(1)
  })
})
