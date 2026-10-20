/** The AI panel's chats are one list, every space's (#332): a space changing keeps the
 *  open chat, its draft and its place, and the chats each space had are all in the list.
 *  The crate's per-space store is played here by a map, so what is kept where is seen. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

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

vi.mock('./setup', () => ({
  engineOf: () => Promise.resolve({ models: () => Promise.resolve([]) }),
}))

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

  test('start a new one on the model last picked, the next time too', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    chat.setModel('p', 'picked')

    const next = await launched()
    next.here('work')
    next.know(['work', 'home'])
    expect(next.head?.model).toBe('picked')
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

  test('open a new one where a new one was open when the panel was left', async () => {
    const garden = await had('home', 'Garden', 1_000)
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await chat.openThread(garden.id, false)
    chat.newThread()

    const next = await launched()
    next.here('work')
    next.know(['work', 'home'])
    await vi.waitFor(() => expect(next.heads).toHaveLength(1))
    expect(next.head?.kept).toBe(false)
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
})
