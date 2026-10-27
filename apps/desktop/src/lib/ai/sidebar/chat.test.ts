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
/** A delete the crate refuses, once. */
const refusing = vi.hoisted(() => ({ delete: false, after: Promise.resolve() }))

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
      if (refusing.delete) {
        refusing.delete = false
        return refusing.after.then(() => Promise.reject(new Error('locked')))
      }
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
  // A message is gathered in its thread's space (gather.ts), which holds no notes here.
  notes: [],
  leftOutOf: () => [],
  noteText: () => Promise.resolve(null),
  // A note made of the thread's words: the path it was written at, or null where the
  // folder may not be written.
  noteFrom: vi.fn((_text: string, folder?: string) =>
    Promise.resolve<string | null>(folder ? `${folder}/Answer.md` : null),
  ),
  open: vi.fn(() => Promise.resolve()),
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
  // Takes nothing: words steered before the engine is ready for them.
  steer: vi.fn((_thread: Thread, _text: string) => Promise.resolve(false)),
}))
vi.mock('./setup', () => ({ engineOf: () => Promise.resolve(engine) }))

// What a review of an agent's edits needs is a workspace of documents, which none of
// this is about.
/** The earlier messages changed, as `turn:words`. */
const edits = vi.hoisted(() => [] as string[])
vi.mock('../review', () => ({
  // An edit sends its words, as the review does once the notes are back.
  editMessage: (
    _thread: unknown,
    turn: string,
    text: string,
    panel: { send(text: string): void },
  ) => {
    edits.push(`${turn}:${text}`)
    panel.send(text)
  },
  lastMessage: () => null,
  openRewind: () => null,
}))

/** A message's gathering, held until `gathering.gate` opens. */
const gathering = vi.hoisted(() => ({ gate: Promise.resolve() }))
vi.mock('./gather', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gather')>()
  return {
    ...real,
    draftOf: async (...args: Parameters<typeof real.draftOf>) => {
      await gathering.gate
      return real.draftOf(...args)
    },
  }
})

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

describe('the field while a message is changed', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
  })

  /** A thread with one message of the reader's in it, open. */
  async function asked() {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.title = 'Plan'
    thread.turns = [
      { id: 'u1', role: 'you', at: 1, parts: [], draft: { text: 'old question', attachments: [] } },
    ]
    await keepThread(thread)
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await chat.openThread(thread.id, false)
    return chat
  }

  const note = { kind: 'note', path: '/notes/Work/Plan.md', name: 'Plan' } as never

  test('keeps the draft aside while an earlier message is edited, and gives it back on Escape', async () => {
    const chat = await asked()
    chat.text = 'a long new draft'
    chat.chips = [note]

    chat.startEdit('u1')
    expect(chat.text).toBe('old question')
    chat.cancelEdit()

    expect(chat.text).toBe('a long new draft')
    expect(chat.chips).toEqual([note])
  })

  test('gives the draft back once the edited message is sent', async () => {
    const chat = await asked()
    chat.text = 'a long new draft'

    chat.startEdit('u1')
    chat.text = 'old question, fixed'
    chat.submit({ front: null, selection: '' })

    expect(chat.editing).toBe(null)
    expect(chat.text).toBe('a long new draft')
  })

  test('keeps the draft aside while a queued message is changed, and gives it back once sent', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const around = { front: null, selection: '' }
    ;(chat as unknown as { queued: Record<string, unknown[]> }).queued = {
      [id]: [{ id: 'q1', text: 'queued words', chips: [], around }],
    }
    chat.text = 'a long new draft'
    chat.chips = [note]

    chat.editQueued('q1')
    expect([chat.text, chat.chips]).toEqual(['queued words', []])
    chat.submit(around)

    expect(chat.text).toBe('a long new draft')
    expect(chat.chips).toEqual([note])
  })

  test('lets a queued message being changed go back to its place on Escape', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const around = { front: null, selection: '' }
    const queued = (n: string) => ({ id: n, text: `${n} words`, chips: [], around })
    ;(chat as unknown as { queued: Record<string, unknown[]> }).queued = {
      [id]: [queued('q1'), queued('q2'), queued('q3')],
    }
    chat.text = 'a long new draft'

    chat.editQueued('q2')
    expect(chat.changing).toBe(true)
    chat.cancelEdit()

    expect(chat.changing).toBe(false)
    expect(chat.text).toBe('a long new draft')
    expect(chat.queue.map((one) => one.id)).toEqual(['q1', 'q2', 'q3'])
  })

  test('lets the edit go when another thread comes to the front', async () => {
    const chat = await asked()
    chat.text = 'a long new draft'
    chat.startEdit('u1')

    chat.newThread()

    expect(chat.changing).toBe(false)
    expect(chat.text).toBe('a long new draft')
  })

  test('keeps an edited message that could not be sent, with the draft it gave back', async () => {
    const chat = await asked()
    engine.send.mockImplementationOnce(() => Promise.reject(new Error('down')))
    chat.text = 'a long new draft'
    chat.startEdit('u1')
    chat.text = 'old question, fixed'

    chat.submit({ front: null, selection: '' })

    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    expect(chat.text).toBe('old question, fixed\n\na long new draft')
  })

  test('keeps a queued message that could not be sent, whatever the field holds by then', async () => {
    const chat = await asked()
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)))
    engine.send.mockImplementationOnce(() => Promise.reject(new Error('down')))
    const around = { front: null, selection: '' }
    chat.text = 'first'
    engine.send.mockClear()
    chat.submit(around)
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    chat.text = 'second'
    chat.submit(around)
    chat.text = 'typed since'

    answer()

    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    expect(chat.text).toBe('second\n\ntyped since')
  })

  /** What the answer running hears, for a steer the engine takes. */
  let hearing: ((event: EngineEvent) => void) | null = null

  /** "first" answering until `answer`, or until stopped, and "second" queued behind it. */
  async function queuedBehind(chat: Awaited<ReturnType<typeof asked>>) {
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce(
      (_thread: Thread, _draft: Draft, on: (event: EngineEvent) => void, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          hearing = on
          answer = resolve
          signal?.addEventListener('abort', () => resolve())
        }),
    )
    engine.send.mockClear()
    chat.text = 'first'
    chat.submit(around)
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    chat.text = 'second'
    chat.submit(around)
    return () => answer()
  }
  const around = { front: null, selection: '' }
  const sentWords = () =>
    (engine.send.mock.calls as unknown as [unknown, Draft][]).map((call) => call[1].text)

  test('sends a queued message let go after the answer before it ended', async () => {
    const chat = await asked()
    const answer = await queuedBehind(chat)
    chat.editQueued(chat.queue[0]!.id)
    answer()
    await vi.waitFor(() => expect(chat.busy).toBe(false))

    chat.cancelEdit()

    await vi.waitFor(() => expect(sentWords()).toEqual(['first', 'second']))
    expect(chat.queue).toEqual([])
  })

  test('sends a queued message let go by another thread coming to the front after the answer ended', async () => {
    const chat = await asked()
    const answer = await queuedBehind(chat)
    chat.editQueued(chat.queue[0]!.id)
    answer()
    await vi.waitFor(() => expect(chat.busy).toBe(false))

    chat.newThread()

    await vi.waitFor(() => expect(sentWords()).toEqual(['first', 'second']))
  })

  test('keeps a queued message let go after a stop waiting in the queue', async () => {
    const chat = await asked()
    await queuedBehind(chat)
    chat.editQueued(chat.queue[0]!.id)
    chat.stop()
    await vi.waitFor(() => expect(chat.busy).toBe(false))

    chat.cancelEdit()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sentWords()).toEqual(['first'])
    expect(chat.queue.map((one) => one.text)).toEqual(['second'])
  })

  test('ends the change of a queued message steered into the running answer', async () => {
    const chat = await asked()
    // The engine takes the words into the answer as a message of their own.
    const steer = vi.fn((thread: Thread, text: string) => {
      const turn = {
        id: crypto.randomUUID(),
        role: 'you' as const,
        at: 1,
        parts: [],
        steered: true,
        draft: { text, attachments: [] },
      }
      thread.turns.push(turn)
      hearing?.({ type: 'turn', turn })
      return Promise.resolve(true)
    })
    ;(engine as unknown as { steer: unknown }).steer = steer
    const answer = await queuedBehind(chat)
    chat.text = 'my draft'
    chat.editQueued(chat.queue[0]!.id)
    chat.text = 'second, changed'

    chat.steer()

    expect([chat.changing, chat.text]).toEqual([false, 'my draft'])
    chat.cancelEdit()
    answer()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    expect(steer).toHaveBeenCalledWith(expect.anything(), 'second, changed')
    expect(sentWords()).toEqual(['first'])
    expect(chat.queue).toEqual([])
  })

  test('ends the change of a queued message the field ran as a command', async () => {
    const chat = await asked()
    const answer = await queuedBehind(chat)
    chat.text = 'my draft'
    chat.editQueued(chat.queue[0]!.id)
    chat.text = '/export'

    chat.taken()

    expect([chat.changing, chat.text]).toEqual([false, 'my draft'])
    chat.cancelEdit()
    answer()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    expect(sentWords()).toEqual(['first'])
  })

  test('puts a queued message being changed back, as changed, when another is taken to change', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const queued = (n: string) => ({ id: n, text: `${n} words`, chips: [], around })
    ;(chat as unknown as { queued: Record<string, unknown[]> }).queued = {
      [id]: [queued('q1'), queued('q2'), queued('q3')],
    }
    chat.text = 'my draft'
    chat.editQueued('q1')
    chat.text = 'q1 changed'

    chat.editQueued('q2')
    expect(chat.text).toBe('q2 words')
    chat.cancelEdit()

    expect(chat.text).toBe('my draft')
    expect(chat.queue.map((one) => one.text)).toEqual(['q1 changed', 'q2 words', 'q3 words'])
  })

  test('puts a queued message being changed back when an earlier message is taken to change', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    ;(chat as unknown as { queued: Record<string, unknown[]> }).queued = {
      [id]: [{ id: 'q1', text: 'q1 words', chips: [], around }],
    }
    chat.text = 'my draft'
    chat.editQueued('q1')

    chat.startEdit('u1')
    expect(chat.text).toBe('old question')
    chat.submit(around)

    expect(chat.text).toBe('my draft')
    expect(chat.queue.map((one) => one.text)).toEqual(['q1 words'])
  })
  /** "first" answered, "second" taken into the field from the queue meanwhile. */
  async function heldAfterAnswer(chat: Awaited<ReturnType<typeof asked>>) {
    const answer = await queuedBehind(chat)
    chat.text = 'my draft'
    chat.editQueued(chat.queue[0]!.id)
    answer()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  test('neither sends nor keeps again a deleted chat’s queued message being changed', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await heldAfterAnswer(chat)

    await chat.remove(id)

    await settled()
    expect(sentWords()).toEqual(['first'])
    expect(kept.get('work')?.has(id)).toBe(false)
  })

  test('does not send an archived chat’s queued message being changed', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await heldAfterAnswer(chat)

    chat.archive(id)

    await vi.waitFor(() => expect(chat.thread?.id).not.toBe(id))
    await settled()
    expect(sentWords()).toEqual(['first'])
  })

  test('gives a queued message let go back in the field where it cannot be sent', async () => {
    const chat = await asked()
    await heldAfterAnswer(chat)
    const { ai } = await import('../store.svelte')
    const gone = vi.spyOn(ai, 'provider').mockReturnValue(null)

    chat.cancelEdit()

    await settled()
    gone.mockRestore()
    expect(chat.text).toBe('second\n\nmy draft')
  })

  test('opens an earlier message to change while a queued one is in the field, and sends the queued one after', async () => {
    const chat = await asked()
    await heldAfterAnswer(chat)

    chat.startEdit('u1')

    expect([chat.changing, chat.text]).toEqual([true, 'old question'])
    expect(chat.queue.map((one) => one.text)).toEqual(['second'])
    await settled()
    expect(sentWords()).toEqual(['first'])
    chat.cancelEdit()
    await vi.waitFor(() => expect(sentWords()).toEqual(['first', 'second']))
  })

  test('sends what was queued while Ask again answered', async () => {
    const chat = await asked()
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)))
    engine.send.mockClear()
    chat.retry()
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    chat.text = 'second'
    chat.submit(around)
    chat.text = 'third'
    chat.submit(around)
    chat.editQueued(chat.queue[1]!.id)

    answer()

    await vi.waitFor(() => expect(sentWords()).toEqual(['old question', 'second']))
    chat.cancelEdit()
    await vi.waitFor(() => expect(sentWords()).toEqual(['old question', 'second', 'third']))
  })

  test('sends what was queued while the chat was compacted', async () => {
    const chat = await asked()
    let done: () => void = () => undefined
    const compact = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    ;(engine as unknown as { compact: unknown }).compact = compact
    engine.send.mockClear()
    chat.compact()
    await vi.waitFor(() => expect(compact).toHaveBeenCalled())
    chat.text = 'second'
    chat.submit(around)
    expect(sentWords()).toEqual([])

    done()

    await vi.waitFor(() => expect(sentWords()).toEqual(['second']))
  })
  test('sends a queued message taken after an earlier one as itself, not as the earlier one changed', async () => {
    const chat = await asked()
    edits.length = 0
    await queuedBehind(chat)
    chat.stop()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    chat.text = 'my draft'
    chat.startEdit('u1')

    chat.editQueued(chat.queue[0]!.id)
    chat.submit(around)

    await vi.waitFor(() => expect(sentWords()).toEqual(['first', 'second']))
    expect(edits).toEqual([])
    expect(chat.changing).toBe(false)
  })

  test('keeps the whole queue of a chat archived while it answers, the message being changed too', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const answer = await queuedBehind(chat)
    chat.text = 'third'
    chat.submit(around)
    chat.editQueued(chat.queue[0]!.id)

    chat.archive(id)
    await vi.waitFor(() => expect(chat.thread?.id).not.toBe(id))
    answer()

    await vi.waitFor(() => expect(sentWords()).toEqual(['first', 'second', 'third']))
  })

  test('keeps a queued message let go by another chat coming to the front in its own chat where it cannot be sent', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await heldAfterAnswer(chat)
    const { ai } = await import('../store.svelte')
    const gone = vi.spyOn(ai, 'provider').mockReturnValue(null)

    chat.newThread()

    await settled()
    gone.mockRestore()
    expect(chat.text).toBe('my draft')
    const queued = (chat as unknown as { queued: Record<string, { text: string }[]> }).queued
    expect(queued[id]?.map((one) => one.text)).toEqual(['second'])
  })

  test('puts a queued message being changed back, as changed, when a rewind takes the field', async () => {
    const chat = await asked()
    await heldAfterAnswer(chat)
    chat.text = 'second, changed'

    chat.release()

    expect([chat.changing, chat.text]).toEqual([false, 'my draft'])
    expect(chat.queue.map((one) => one.text)).toEqual(['second, changed'])
    await settled()
    expect(sentWords()).toEqual(['first'])
  })
})

describe('a note made of a thread', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
    place.noteFrom.mockClear()
  })

  /** A thread asked in `space`, open while `front` is the space in front. */
  async function openIn(space: string, front: string) {
    const thread = await had(space, 'Plan', 1_000)
    const chat = await launched()
    chat.here(space)
    chat.know(['work', 'home'])
    await chat.openThread(thread.id, false)
    chat.here(front)
    place.activeSpaceId = front
    return chat
  }

  const said = (chat: { thread: Thread | null }) =>
    chat.thread?.turns.flatMap((turn) =>
      turn.parts.flatMap((part) => (part.kind === 'notice' ? [part.text] : [])),
    )

  test('is written in the thread’s own space, not the one in front', async () => {
    const chat = await openIn('work', 'home')

    await chat.exportThread()

    expect(place.noteFrom.mock.calls.map((call) => call[1])).toEqual(['/notes/Work'])
  })

  test('is refused, and says so, where the thread’s space may only be read', async () => {
    const chat = await openIn('work', 'home')
    place.noteFrom.mockResolvedValueOnce(null)

    await chat.noteFrom('# Answer\n')

    expect(place.noteFrom).toHaveBeenCalledTimes(1)
    await vi.waitFor(() =>
      expect(said(chat)).toEqual(['Save as a note · you can only read this space']),
    )
  })

  test('is refused, and says so, where the thread’s space is not on this device', async () => {
    const chat = await openIn('work', 'home')
    if (chat.thread) chat.thread.space = 'gone'

    await chat.noteFrom('# Answer\n')

    expect(place.noteFrom).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(said(chat)).toEqual(['Save as a note · no such space']))
  })
})

describe('a chat while it answers', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
    engine.send.mockReset()
    // An engine that takes no steered words, whatever an earlier test made it.
    engine.steer = vi.fn((_thread: Thread, _text: string) => Promise.resolve(false))
  })

  const around = { front: null, selection: '' }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 30))

  async function asked() {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.title = 'Plan'
    thread.turns = [
      { id: 'u1', role: 'you', at: 1, parts: [], draft: { text: 'old question', attachments: [] } },
    ]
    await keepThread(thread)
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await chat.openThread(thread.id, false)
    return chat
  }

  test('stays deleted once deleted while it answers', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, _on: unknown, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
          thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
          signal?.addEventListener('abort', () => resolve())
        }),
    )
    chat.text = 'go on'
    chat.submit(around)
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))

    await chat.remove(id)
    await settled()

    expect(deleted).toEqual([`work/${id}`])
    expect(kept.get('work')?.has(id)).toBe(false)
    expect(chat.heads.map((one) => one.id)).not.toContain(id)
  })

  test('keeps a first message on its way in the space it was asked in', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await settled()
    let go: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (go = resolve))
    engine.send.mockImplementationOnce(
      async (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
        await gate
        thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
        thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
        on({ type: 'done', stop: 'end' })
      },
    )
    chat.text = 'what is in my work notes'
    chat.submit(around)
    const id = String(chat.thread?.id)
    // The reader moves to another space while the message is gathered and first asked.
    chat.here('home')
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    go()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    await settled()

    expect(chat.thread?.space).toBe('work')
    expect(kept.get('work')?.has(id)).toBe(true)
    expect(kept.get('home')?.has(id) ?? false).toBe(false)
  })

  test('keeps the message and its answer on Ask again where the provider is gone', async () => {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'gone', 'm')
    thread.title = 'Plan'
    thread.turns = [
      { id: 'u1', role: 'you', at: 1, parts: [], draft: { text: 'old question', attachments: [] } },
      { id: 'm1', role: 'model', at: 2, parts: [{ kind: 'text', text: 'the answer' }] },
    ]
    await keepThread(thread)
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await chat.openThread(thread.id, false)
    const { ai } = await import('../store.svelte')
    const gone = vi.spyOn(ai, 'provider').mockReturnValue(null)

    chat.retry()

    gone.mockRestore()
    expect(chat.thread?.turns.map((one) => one.id)).toEqual(['u1', 'm1'])
    expect(chat.trouble).toBeTruthy()
    expect(engine.send).not.toHaveBeenCalled()
  })

  test('keeps the message and its answer on Ask again refused before any turn', async () => {
    const chat = await asked()
    const thread = chat.thread!
    thread.turns.push({ id: 'm1', role: 'model', at: 2, parts: [] })
    engine.send.mockImplementationOnce(() => Promise.reject(new Error('down')))
    // The list read at launch is in before the reader asks again.
    await settled()

    chat.retry()

    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    expect(thread.turns.map((one) => one.id)).toEqual(['u1', 'm1'])
  })
  /** The next message held while it is gathered, until the returned call. */
  function held(): () => void {
    let go: () => void = () => undefined
    gathering.gate = new Promise<void>((resolve) => (go = resolve))
    return () => {
      go()
      gathering.gate = Promise.resolve()
    }
  }

  /** An answer that pushes the reader's turn and ends as stopped where it was. */
  function stoppable() {
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
          thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
          const end = () => {
            on({ type: 'done', stop: 'stopped' })
            resolve()
          }
          if (signal?.aborted) end()
          else signal?.addEventListener('abort', end)
        }),
    )
  }

  const words = (thread: Thread | null) =>
    (thread?.turns ?? []).filter((one) => one.role === 'you').map((one) => one.draft?.text)

  test('keeps a message stopped while it is gathered', async () => {
    const chat = await asked()
    await settled()
    const go = held()
    stoppable()
    chat.text = 'my new question'
    chat.submit(around)
    expect(chat.busy).toBe(true)

    chat.stop()
    go()
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    await settled()

    const id = String(chat.thread?.id)
    expect(words(chat.thread)).toEqual(['old question', 'my new question'])
    expect(kept.get('work')?.get(id)?.body).toContain('my new question')
  })

  test('asks nothing of a chat deleted while its message is gathered', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await settled()
    const go = held()
    chat.text = 'my new question'
    chat.submit(around)

    await chat.remove(id)
    go()
    await settled()

    expect(engine.send).not.toHaveBeenCalled()
    expect(kept.get('work')?.has(id)).toBe(false)
  })

  test('sends next the words steered in that the answer never took', async () => {
    const chat = await asked()
    await settled()
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
        new Promise<void>((resolve) => {
          thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
          thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
          answer = () => {
            on({ type: 'done', stop: 'end' })
            resolve()
          }
        }),
    )
    chat.text = 'first'
    chat.submit(around)
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    chat.text = 'and shorter'
    chat.steer()
    expect(chat.text).toBe('')

    answer()

    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(2))
    const sent = engine.send.mock.calls as unknown as [unknown, Draft][]
    expect(sent.map((call) => call[1].text)).toEqual(['first', 'and shorter'])
  })

  test('follows the reader again once a first message refused before any turn is back', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await settled()
    const go = held()
    engine.send.mockImplementationOnce(() => Promise.reject(new Error('down')))
    chat.text = 'first'
    chat.submit(around)
    chat.here('home')
    go()
    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    await settled()

    expect(chat.thread?.turns).toEqual([])
    expect(chat.thread?.space).toBe('home')
  })

  test('keeps writing a chat whose delete was refused', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await settled()
    refusing.delete = true

    await chat.remove(id)
    await chat.openThread(id, false)
    await chat.rename('Plan, still here', id)
    await settled()

    expect(chat.heads.map((one) => one.id)).toContain(id)
    expect(kept.get('work')?.get(id)?.body).toContain('Plan, still here')
  })
  test('sends next only the steered words the answer never took, once', async () => {
    const chat = await asked()
    await settled()
    const go = held()
    let ready = false
    let hear: (event: EngineEvent) => void = () => undefined
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
        new Promise<void>((resolve) => {
          thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
          thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
          ready = true
          hear = on
          answer = () => {
            on({ type: 'done', stop: 'end' })
            resolve()
          }
        }),
    )
    // Takes words only once the answer is ready for them, as both engines do.
    engine.steer = vi.fn((thread: Thread, text: string) => {
      if (!ready) return Promise.resolve(false)
      const turn = {
        id: crypto.randomUUID(),
        role: 'you' as const,
        at: 1,
        parts: [],
        steered: true,
        draft: { text, attachments: [] },
      }
      thread.turns.push(turn)
      hear({ type: 'turn', turn })
      return Promise.resolve(true)
    })
    chat.text = 'first'
    chat.submit(around)
    // While the message is gathered: the engine is not ready for these.
    chat.text = 'A'
    chat.steer()
    await settled()
    go()
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    chat.text = 'B'
    chat.steer()
    await settled()

    answer()

    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(2))
    await settled()
    const sent = engine.send.mock.calls as unknown as [unknown, Draft][]
    expect(sent.map((call) => call[1].text)).toEqual(['first', 'A'])
    expect(words(chat.thread).filter((one) => one === 'B')).toHaveLength(1)
  })

  test('keeps the provider picked for a fresh chat whose first message is refused', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await settled()
    chat.setModel('other', 'm2')
    engine.send.mockImplementationOnce(() => Promise.reject(new Error('down')))
    chat.text = 'first'
    chat.submit(around)
    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    await settled()

    expect([chat.thread?.provider, chat.thread?.model]).toEqual(['other', 'm2'])
  })

  test('keeps the message of a chat whose delete was refused while it was gathered', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await settled()
    const go = held()
    stoppable()
    let refuse: () => void = () => undefined
    refusing.delete = true
    refusing.after = new Promise<void>((resolve) => (refuse = resolve))
    chat.text = 'my new question'
    chat.submit(around)

    // The message is gathered before the crate says the delete failed.
    const removing = chat.remove(id)
    await settled()
    go()
    await settled()
    refuse()
    await removing
    await vi.waitFor(() => expect(chat.busy).toBe(false))
    await settled()

    expect(chat.heads.map((one) => one.id)).toContain(id)
    expect(kept.get('work')?.get(id)?.body).toContain('my new question')
  })
})
