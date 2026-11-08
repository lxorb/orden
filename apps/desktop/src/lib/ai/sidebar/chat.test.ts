import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import type { Draft, EngineEvent, Part, Thread, Turn } from '../chat/types'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const kept = vi.hoisted(() => new Map<string, Map<string, { head: unknown; body: string }>>())
const deleted = vi.hoisted(() => [] as string[])
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
  notes: [],
  leftOutOf: () => [],
  noteText: () => Promise.resolve(null),
  noteFrom: vi.fn((_text: string, folder?: string) =>
    Promise.resolve<string | null>(folder ? `${folder}/Answer.md` : null),
  ),
  open: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../workspace.svelte', () => ({ workspace: place }))

vi.mock('../commands/found', () => ({
  fromOthers: () => Promise.resolve(false),
  fromOthersIn: () => Promise.resolve(false),
}))

vi.mock('../store.svelte', () => {
  const provider = { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' }
  return { ai: { providerFor: () => provider, provider: () => provider } }
})

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
  steer: vi.fn((_thread: Thread, _text: string) => Promise.resolve(false)),
}))
vi.mock('./setup', () => ({ engineOf: () => Promise.resolve(engine) }))

const edits = vi.hoisted(() => [] as string[])
vi.mock('../review', () => ({
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

const ticking = vi.hoisted(() => ({
  answer: null as { id: string; ticked: boolean } | null,
  asked: [] as string[],
}))
vi.mock('../../prompt.svelte', () => ({
  prompt: {
    confirm: () => Promise.resolve(true),
    chooseTicking: (options: { title: string }) => {
      ticking.asked.push(options.title)
      return Promise.resolve(ticking.answer)
    },
  },
}))

async function launched() {
  vi.resetModules()
  return (await import('./chat.svelte')).chat
}

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
    localStorage.setItem('orden:ai-sidebar', JSON.stringify({ open: { home: 'none-left' } }))

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

  test('let go of a chat read once another is open, so a long session holds only what it shows', async () => {
    const names = Array.from({ length: 12 }, (_, at) => `Chat ${String(at)}`)
    const made = []
    for (const [at, name] of names.entries()) made.push(await had('work', name, 1_000 + at))
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    for (const one of made) await chat.openThread(one.id, false)

    const held = (chat as unknown as { live: Map<string, unknown> }).live
    expect([...held.keys()]).toEqual([made.at(-1)?.id])
    await chat.openThread(made[0]?.id ?? '', false)
    expect(chat.thread?.title).toBe('Chat 0')
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
    await chat.chooseModel('p', 'picked')

    const next = await launched()
    next.here('work')
    next.know(['work', 'home'])
    expect(next.head?.model).toBe('picked')
  })

  test('open the one open last, whichever space it is in', async () => {
    const garden = await had('home', 'Garden', 1_000)
    await had('work', 'Quarterly plan', 9_000)
    localStorage.setItem('orden:ai-sidebar', JSON.stringify({ last: garden.id }))
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

  test('say which space a running thread works in, for its calls that name none', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    const { callerOf, threadSpaceOf } = await import('../../automation/caller')
    const aside = chat.startAside('home', 'Book the dentist', 'auto', 'Do this task')
    const task = chat.running[0] ?? ''
    const agent = { id: 'orden-anthropic', name: 'Claude', built_in: true }
    expect(threadSpaceOf(callerOf(agent, task))).toBe('home')
    expect(threadSpaceOf(callerOf(agent, 'nobody'))).toBeNull()
    expect(threadSpaceOf(callerOf(agent))).toBeNull()
    await aside
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

  let hearing: ((event: EngineEvent) => void) | null = null

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
      expect(said(chat)).toEqual(['Save as a note: you can only read this space']),
    )
  })

  test('is refused, and says so, where the thread’s space is not on this device', async () => {
    const chat = await openIn('work', 'home')
    if (chat.thread) chat.thread.space = 'gone'

    await chat.noteFrom('# Answer\n')

    expect(place.noteFrom).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(said(chat)).toEqual(['Save as a note: no such space']))
  })
})

describe('a chat while it answers', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
    engine.send.mockReset()
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

  test('a deleted chat stops all the work it started', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const { tasks } = await import('../commands/tasks.svelte')
    const { helpers } = await import('../helpers/helpers.svelte')
    const { newThread } = await import('../chat/threads')
    const note = newThread('work', 'p', 'm')
    const open = chat.thread
    if (!open) throw new Error('open')
    helpers.startedUnder(open, note)
    const batch = vi.fn()
    const under = vi.fn()
    const other = vi.fn()
    tasks.add({ thread: id, kind: 'batch', label: 'Inbox/', stop: batch })
    tasks.add({ thread: note.id, kind: 'subtask', label: 'deeper', helper: 'h2', stop: under })
    tasks.add({ thread: 'elsewhere', kind: 'loop', label: 'keep on', stop: other })

    await chat.remove(id)

    await vi.waitFor(() => expect(batch).toHaveBeenCalled())
    expect(under).toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
    expect(tasks.of(id)).toEqual([])
    expect(deleted).toEqual([`work/${id}`])
    tasks.stop('elsewhere')
  })

  test('Stop and delete end a run_agent helper on the panel’s road', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await settled()
    const { helpers } = await import('../helpers/helpers.svelte')
    const parent = chat.threadOf(id)
    if (!parent) throw new Error('held')
    const signals: AbortSignal[] = []
    engine.send.mockImplementation(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
          thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
          if (signal) signals.push(signal)
          signal?.addEventListener('abort', () => {
            on({ type: 'done', stop: 'stopped' })
            resolve()
          })
        }),
    )
    const provider = { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' } as const
    const roads = {
      offered: () => Promise.resolve([{ provider, models: [] }]),
      run: (thread: Thread, text: string, signal: AbortSignal) => {
        chat.adopt(thread)
        return chat.turn(thread, text, { signal })
      },
    }
    const ask = {
      parent,
      space: 'work',
      prompt: 'Fix every note in Inbox',
      description: 'inbox',
      model: '',
      mode: parent.mode,
    }
    try {
      const first = await helpers.start(ask, roads)
      if ('refused' in first) throw new Error(first.refused)
      await vi.waitFor(() => expect(signals).toHaveLength(1))

      chat.stop()
      await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))
      expect((parent as Thread & { helpers?: string[] }).helpers).toEqual([first.id])

      const second = await helpers.start(ask, roads)
      if ('refused' in second) throw new Error(second.refused)
      await vi.waitFor(() => expect(signals).toHaveLength(2))
      await chat.remove(id)
      await vi.waitFor(() => expect(signals[1]?.aborted).toBe(true))
    } finally {
      engine.send.mockReset()
    }
  })

  test('a delete refused leaves the work the chat started running', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    await settled()
    const { tasks } = await import('../commands/tasks.svelte')
    const loop = vi.fn()
    tasks.add({ thread: id, kind: 'loop', label: 'keep on', stop: loop })
    refusing.delete = true

    await chat.remove(id)
    await settled()

    expect(chat.heads.map((one) => one.id)).toContain(id)
    expect(loop).not.toHaveBeenCalled()
    tasks.stop(id)
  })

  test('Stop stops the work the open chat started', async () => {
    const chat = await asked()
    const id = String(chat.thread?.id)
    const { tasks } = await import('../commands/tasks.svelte')
    const fork = vi.fn()
    tasks.add({ thread: id, kind: 'fork', label: 'a copy', helper: 'h3', stop: fork })

    chat.stop()

    await vi.waitFor(() => expect(fork).toHaveBeenCalled())
    expect(tasks.of(id)).toEqual([])
  })

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

  test('stays deleted once deleted in another window while it answers here', async () => {
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

    kept.get('work')?.delete(id)
    const { windows } = await import('../../windows')
    ;(windows as unknown as { heard(said: unknown): void }).heard({
      kind: 'thread-deleted',
      from: 'another window',
      id,
      space: 'work',
    })
    await settled()

    expect(kept.get('work')?.has(id)).toBe(false)
    expect(chat.heads.map((one) => one.id)).not.toContain(id)
    expect(chat.thread?.id).not.toBe(id)
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
    await settled()

    chat.retry()

    await vi.waitFor(() => expect(chat.trouble).toBe('down'))
    expect(thread.turns.map((one) => one.id)).toEqual(['u1', 'm1'])
  })
  function held(): () => void {
    let go: () => void = () => undefined
    gathering.gate = new Promise<void>((resolve) => (go = resolve))
    return () => {
      go()
      gathering.gate = Promise.resolve()
    }
  }

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

  test('starts a new chat while the first message of the open one is gathered', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    chat.newThread()
    const first = String(chat.thread?.id)
    const go = held()
    chat.text = 'the first question'
    chat.submit(around)
    expect(chat.busy).toBe(true)

    chat.newThread()

    expect(chat.thread?.id).not.toBe(first)
    go()
    await settled()
    expect(words(chat.thread)).toEqual([])
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
    await chat.chooseModel('other', 'm2')
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

describe('the panel’s chats and their helpers (#1062)', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
  })

  test('list and count only the chats the reader started; a helper opens from its parent', async () => {
    const parent = await had('work', 'Serie 6', 3_000)
    const { keepThread } = await import('../chat/threads')
    const helper = await had('work', '↳ Serie 06 – Aufgabe 5', 4_000)
    helper.parent = parent.id
    await keepThread(helper)
    await had('home', 'Garden', 2_000)

    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await vi.waitFor(() => expect(chat.every).toHaveLength(3))

    expect(chat.heads.map((one) => one.title)).toEqual(['Serie 6', 'Garden'])
    await chat.openThread(helper.id, false)
    expect(chat.head).toMatchObject({ id: helper.id, parent: parent.id })
  })

  test('list a helper whose parent is gone, so it is not lost', async () => {
    const { keepThread } = await import('../chat/threads')
    const helper = await had('work', '↳ Aufgabe 5', 4_000)
    helper.parent = 'deleted-long-ago'
    await keepThread(helper)

    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.heads.map((one) => one.title)).toEqual(['↳ Aufgabe 5']))
  })

  test('take the helpers kept before they said whose they were out of the list, once', async () => {
    const { keepThread, readThread } = await import('../chat/threads')
    const parent = await had('work', 'Serie 6', 3_000)
    const helper = await had('work', '↳ Aufgabe 5', 4_000)
    const deeper = await had('work', '↳ Aufgabe 5b', 4_500)
    const subtask = await had('work', 'check the proof', 4_200)
    const fork = await had('work', 'Serie 6', 5_000)
    Object.assign(parent, { helpers: [helper.id, deeper.id, subtask.id, fork.id] })
    Object.assign(helper, { helpers: [deeper.id] })
    await keepThread(parent)
    await keepThread(helper)

    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() =>
      expect(chat.heads.map((one) => one.title)).toEqual(['Serie 6', 'Serie 6']),
    )
    expect(chat.heads.map((one) => one.id).sort()).toEqual([parent.id, fork.id].sort())
    expect((await readThread('work', deeper.id))?.parent).toBe(helper.id)
    expect((await readThread('work', subtask.id))?.parent).toBe(parent.id)
    expect(localStorage.getItem('orden:ai-helpers-parented:work')).toBe('true')
    expect(chat.every).toHaveLength(5)
  })
})

describe('a chat’s unread mark (#1064)', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
  })

  test('comes with an answer, goes once seen, and both outlast a restart', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    chat.text = 'how far is the moon'
    chat.submit({ front: null, selection: '' })
    const asked = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.unread.has(asked)).toBe(true))

    const again = await launched()
    again.know(['work'])
    await vi.waitFor(() => expect(again.unread.has(asked)).toBe(true))
    await again.saw(asked)
    expect(again.unread.has(asked)).toBe(false)

    const third = await launched()
    third.know(['work'])
    await vi.waitFor(() => expect(third.every.map((one) => one.id)).toContain(asked))
    expect(third.unread.has(asked)).toBe(false)
  })

  test('comes with a question for the reader, before the answer is over', async () => {
    let release: () => void = () => undefined
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
        thread.turns.push({ id: 'y', role: 'you', at: 1, parts: [], draft })
        const part = {
          kind: 'tool',
          id: 'c1',
          verb: 'edit_note',
          args: {},
          state: 'asking',
        } as const
        thread.turns.push({ id: 'm', role: 'model', at: 1, parts: [part] })
        on({ type: 'part', turn: 'm', index: 0, part })
        return new Promise<void>((done) => (release = done))
      },
    )
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    chat.text = 'tidy Birds'
    chat.submit({ front: null, selection: '' })
    const asked = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.unread.has(asked)).toBe(true))
    expect(chat.running).toContain(asked)
    release()
  })

  test('a helper’s answer is its chat’s, and a command’s line is one too', async () => {
    const parent = await had('work', 'Serie 6', 3_000)
    const { keepThread } = await import('../chat/threads')
    const helper = await had('work', '↳ Aufgabe 5', 4_000)
    helper.parent = parent.id
    await keepThread(helper)
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.every).toHaveLength(2))
    expect(chat.unread.size).toBe(0)

    chat.answered(helper)
    expect([...chat.unread]).toEqual([parent.id])
    await chat.saw(parent.id)
    expect(chat.unread.size).toBe(0)

    const { hostOf } = await import('../commands/host')
    hostOf(chat).line(parent, '↳ done')
    expect([...chat.unread]).toEqual([parent.id])
  })
})

describe('an answer on its way', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
  })

  async function answering() {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    const model: Turn = { id: 'answer', role: 'model', at: 2, parts: [] }
    const engaged: { on: (event: EngineEvent) => void; end: () => void; thread: Thread }[] = []
    engine.send.mockImplementation(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
        new Promise<void>((resolve) => {
          const you: Turn = { id: 'message', role: 'you', at: 1, parts: [], draft }
          thread.turns.push(you, model)
          on({ type: 'turn', turn: you })
          on({ type: 'turn', turn: model })
          engaged.push({ on, thread, end: resolve })
        }),
    )
    chat.send('Tidy the herons')
    await vi.waitFor(() => expect(engaged).toHaveLength(1))
    const [one] = engaged
    if (!one) throw new Error('never asked')
    const written = async () => {
      const body = kept.get('work')?.get(one.thread.id)?.body
      return body ? (JSON.parse(body) as Thread) : null
    }
    const word = (text: string) => {
      const part = { kind: 'text', text } as const
      model.parts[0] = part
      one.on({ type: 'part', turn: model.id, index: 0, part })
    }
    return { chat, model, one, written, word }
  }

  test('has the message written down as it begins, and that it is still answering', async () => {
    const { written } = await answering()

    await vi.waitFor(async () => {
      const thread = await written()
      expect(thread?.turns.map((one) => one.id)).toEqual(['message', 'answer'])
      expect(thread?.answering).toBe('answer')
    })
  })

  test('has its words written when the window goes, without waiting for the answer', async () => {
    const { written, word } = await answering()
    word('Herons stand')

    const { settleUp } = await import('../../parting')
    settleUp()

    await vi.waitFor(async () =>
      expect((await written())?.turns[1]?.parts[0]).toEqual({ kind: 'text', text: 'Herons stand' }),
    )
  })

  test('has its words written every few seconds as they arrive', async () => {
    const { written, word } = await answering()
    await vi.waitFor(async () => expect((await written())?.answering).toBe('answer'))
    vi.useFakeTimers()
    try {
      word('Herons')
      await vi.advanceTimersByTimeAsync(10_000)
    } finally {
      vi.useRealTimers()
    }

    await vi.waitFor(async () =>
      expect((await written())?.turns[1]?.parts[0]).toEqual({ kind: 'text', text: 'Herons' }),
    )
  })

  test('has what a finished call changed written at once', async () => {
    const { model, one, written } = await answering()
    const part = {
      kind: 'tool',
      id: 'c',
      verb: 'edit_note',
      args: {},
      state: 'ok',
      change: { path: 'Birds.md', added: 2, removed: 1 },
    } as const
    model.parts[0] = part
    one.on({ type: 'part', turn: model.id, index: 0, part })

    await vi.waitFor(async () => expect((await written())?.turns[1]?.parts[0]).toEqual(part))
  })

  test('reads back cut off, in the same thread, after a reload', async () => {
    const { one, word } = await answering()
    word('Herons stand')
    const { settleUp } = await import('../../parting')
    settleUp()
    const { readThread } = await import('../chat/threads')

    await vi.waitFor(async () => {
      const again = await readThread('work', one.thread.id)
      expect(again?.turns[1]?.parts).toEqual([
        { kind: 'text', text: 'Herons stand' },
        { kind: 'notice', code: 'stopped', text: '' },
      ])
    })
  })

  test('is written with the thread’s own mode and model, not a one-shot send’s', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    const { newThread, readThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm', 'auto', 'approve')
    const model: Turn = { id: 'answer', role: 'model', at: 2, parts: [] }
    const engaged: ((event: EngineEvent) => void)[] = []
    engine.send.mockImplementation(
      (one: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
        new Promise<void>(() => {
          const you: Turn = { id: 'message', role: 'you', at: 1, parts: [], draft }
          one.turns.push(you, model)
          on({ type: 'turn', turn: you })
          on({ type: 'turn', turn: model })
          engaged.push(on)
        }),
    )

    void chat.turn(thread, 'Review this', { mode: 'auto', model: 'other', effort: 'high' })
    await vi.waitFor(() => expect(engaged).toHaveLength(1))

    await vi.waitFor(async () => {
      const again = await readThread('work', thread.id)
      expect(again?.turns).toHaveLength(2)
      expect(again).toMatchObject({ mode: 'approve', model: 'm', effort: 'auto' })
    })
    expect(thread).toMatchObject({ mode: 'auto', model: 'other', effort: 'high' })
  })

  test('is written again while nothing arrives, so another window knows it is alive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const { one, written } = await answering()
      await vi.waitFor(async () => expect((await written())?.answering).toBe('answer'))
      const first = (await written()) as Thread & { answeringAt: number }
      await vi.advanceTimersByTimeAsync(60_000)

      await vi.waitFor(async () => {
        const now = (await written()) as Thread & { answeringAt: number }
        expect(now.answeringAt).toBeGreaterThan(first.answeringAt)
      })
      one.end()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a send behind an answer in another window waits, and starts from what the file holds', async () => {
    const chat = await launched()
    chat.here('work')
    const { keepThread, newThread, readThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.turns = [
      { id: 'y', role: 'you', at: 1, parts: [], draft: { text: 'Hi', attachments: [] } },
      { id: 'm', role: 'model', at: 2, parts: [{ kind: 'text', text: 'stale' }] },
    ]
    await keepThread(thread)
    thread.elsewhere = true
    chat.adopt(thread, true)
    engine.send.mockClear()
    const held = chat as unknown as { readAgain(id: string): Promise<void>; enqueue: unknown }
    const reading = vi.spyOn(held, 'readAgain').mockResolvedValue(undefined)

    chat.send('Next')
    expect(engine.send).not.toHaveBeenCalled()
    expect(thread.turns).toHaveLength(2)
    reading.mockRestore()

    const finished = await readThread('work', thread.id)
    if (!finished) throw new Error('no thread')
    finished.turns[1] = { id: 'm', role: 'model', at: 2, parts: [{ kind: 'text', text: 'whole' }] }
    await keepThread(finished)
    await held.readAgain(thread.id)

    await vi.waitFor(() => expect(engine.send).toHaveBeenCalled())
    const live = (await readThread('work', thread.id))?.turns ?? []
    expect(JSON.stringify(live)).toContain('whole')
    expect(JSON.stringify(live)).not.toContain('stale')
  })

  test('started in two windows at once is answered in one, and the other asks after it', async () => {
    type Granted = (lock: { name: string } | null) => unknown
    const held = new Map<string, (() => void)[]>()
    const locks = {
      request: async (
        name: string,
        options: { ifAvailable?: boolean } | Granted,
        given?: Granted,
      ) => {
        const callback = typeof options === 'function' ? options : given
        const ifAvailable = typeof options === 'function' ? false : !!options.ifAvailable
        if (!callback) throw new Error('no callback')
        await Promise.resolve()
        const waiting = held.get(name)
        if (waiting && ifAvailable) return callback(null)
        if (waiting) await new Promise<void>((free) => waiting.push(free))
        held.set(name, held.get(name) ?? [])
        try {
          return await callback({ name })
        } finally {
          const next = held.get(name)?.shift()
          if (next) next()
          else held.delete(name)
        }
      },
    }
    const had = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
    try {
      const { keepThread, newThread, readThread } = await import('../chat/threads')
      const thread = newThread('work', 'p', 'm')
      thread.turns = [
        { id: 'y', role: 'you', at: 1, parts: [], draft: { text: 'Hi', attachments: [] } },
        { id: 'm', role: 'model', at: 2, parts: [{ kind: 'text', text: 'Hello' }] },
      ]
      await keepThread(thread)
      const ends: (() => void)[] = []
      engine.send.mockReset()
      engine.send.mockImplementation(
        (asked: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
          new Promise<void>((resolve) => {
            const at = asked.turns.length
            const you: Turn = { id: `you-${at}`, role: 'you', at: 3, parts: [], draft }
            const model: Turn = { id: `model-${at}`, role: 'model', at: 4, parts: [] }
            asked.turns.push(you, model)
            on({ type: 'turn', turn: you })
            on({ type: 'turn', turn: model })
            ends.push(() => {
              on({ type: 'done', stop: 'end' })
              resolve()
            })
          }),
      )
      const one = await launched()
      one.here('work')
      const mine = await readThread('work', thread.id)
      if (!mine) throw new Error('no thread')
      one.adopt(mine, true)
      const two = await launched()
      two.here('work')
      const theirs = await readThread('work', thread.id)
      if (!theirs) throw new Error('no thread')
      two.adopt(theirs, true)

      one.send('From the first window')
      two.send('From the second window')

      await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(two.running).toEqual([]), 3000)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(engine.send).toHaveBeenCalledTimes(1)

      ends.shift()?.()
      await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(2))
      const second = engine.send.mock.calls[1]
      expect(second?.[1].text).toContain('From the second window')
      expect(second?.[0].turns.slice(0, 4).map((turn) => turn.id)).toEqual([
        'y',
        'm',
        'you-2',
        'model-2',
      ])
      ends.shift()?.()
    } finally {
      if (had) Object.defineProperty(navigator, 'locks', had)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  test('written in another window draws again only the turns that changed', async () => {
    const chat = await launched()
    chat.here('work')
    const { keepThread, newThread, readThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.turns = [
      { id: 'y', role: 'you', at: 1, parts: [], draft: { text: 'Hi', attachments: [] } },
      { id: 'm', role: 'model', at: 2, parts: [{ kind: 'text', text: 'Hello' }] },
      { id: 'y2', role: 'you', at: 3, parts: [], draft: { text: 'More', attachments: [] } },
      { id: 'm2', role: 'model', at: 4, parts: [{ kind: 'text', text: 'Some' }] },
    ]
    await keepThread(thread)
    const mine = await readThread('work', thread.id)
    if (!mine) throw new Error('no thread')
    chat.adopt(mine, true)
    const before = chat.turns

    const theirs = await readThread('work', thread.id)
    if (!theirs) throw new Error('no thread')
    theirs.turns[3] = {
      id: 'm2',
      role: 'model',
      at: 4,
      parts: [{ kind: 'text', text: 'Some more' }],
    }
    await keepThread(theirs)
    ;(chat as unknown as { heardWritten(id: string): void }).heardWritten(thread.id)

    await vi.waitFor(() =>
      expect(chat.turns[3]?.parts).toEqual([{ kind: 'text', text: 'Some more' }]),
    )
    expect(chat.turns.slice(0, 3)).toEqual(before.slice(0, 3))
    chat.turns.slice(0, 3).forEach((turn, at) => expect(turn).toBe(before[at]))
  })

  test('in another window is not asked again from this one', async () => {
    const chat = await launched()
    chat.here('work')
    const { newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.turns = [
      { id: 'y', role: 'you', at: 1, parts: [], draft: { text: 'Hi', attachments: [] } },
      { id: 'm', role: 'model', at: 2, parts: [] },
    ]
    thread.elsewhere = true
    engine.send.mockClear()

    chat.retry(undefined, thread)

    expect(engine.send).not.toHaveBeenCalled()
    expect(thread.turns).toHaveLength(2)
  })

  test('is written without the mark once it has ended', async () => {
    const { model, one, written } = await answering()
    one.on({ type: 'done', stop: 'end' })
    one.end()

    await vi.waitFor(async () => {
      expect((await written())?.answering).toBeUndefined()
      expect((await written())?.turns[1]?.id).toBe(model.id)
    })
  })
})

describe('where a chat stands', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
    engine.send.mockReset()
    ticking.asked.length = 0
  })

  const around = { front: null, selection: '' }

  async function opened() {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    return chat
  }

  const answers = (stop: 'end' | 'stopped' | 'error', ask = false) =>
    engine.send.mockImplementation(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
        const turn = { id: crypto.randomUUID(), role: 'model' as const, at: 1, parts: [] }
        thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
        thread.turns.push(turn)
        if (ask)
          on({
            type: 'part',
            turn: turn.id,
            index: 0,
            part: { kind: 'tool', id: 't', verb: 'edit', input: {}, state: 'asking' },
          } as unknown as EngineEvent)
        on({ type: 'done', stop })
        return Promise.resolve()
      },
    )

  test('done once an answer runs to its end, and written down so', async () => {
    answers('end')
    const chat = await opened()
    chat.text = 'hello'
    chat.submit(around)
    const id = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.states.get(id)).toBe('done'))
    expect(chat.thread?.state).toBe('done')
  })

  test('an error where the answer failed, waiting while it waits on the plan', async () => {
    const chat = await opened()
    engine.send.mockImplementation(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
        thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
        thread.turns.push({ id: crypto.randomUUID(), role: 'model', at: 1, parts: [] })
        on({ type: 'limit', limit: { state: 'reached', until, untilWords: null } })
        on({ type: 'done', stop: 'error', error: 'At its limit' })
        return Promise.resolve()
      },
    )
    chat.text = 'go on'
    chat.submit(around)
    const id = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.states.get(id)).toBe('error'))
    chat.waitForReset(true)
    expect(chat.states.get(id)).toBe('waiting')
    chat.waitForReset(false)
    expect(chat.states.get(id)).toBe('error')
  })

  test('interrupted where it was stopped short', async () => {
    answers('stopped')
    const chat = await opened()
    chat.text = 'hello'
    chat.submit(around)
    const id = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.states.get(id)).toBe('interrupted'))
  })

  test('needs input while the agent waits on the reader', async () => {
    let release: () => void = () => undefined
    engine.send.mockImplementation(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) => {
        const turn = { id: crypto.randomUUID(), role: 'model' as const, at: 1, parts: [] }
        thread.turns.push({ id: crypto.randomUUID(), role: 'you', at: 1, parts: [], draft })
        thread.turns.push(turn)
        on({
          type: 'part',
          turn: turn.id,
          index: 0,
          part: { kind: 'tool', id: 't', verb: 'edit', input: {}, state: 'asking' },
        } as unknown as EngineEvent)
        return new Promise<void>((resolve) => {
          release = () => {
            on({
              type: 'part',
              turn: turn.id,
              index: 0,
              part: { kind: 'tool', id: 't', verb: 'edit', input: {}, state: 'ok' },
            } as unknown as EngineEvent)
            on({ type: 'done', stop: 'end' })
            resolve()
          }
        })
      },
    )
    const chat = await opened()
    chat.text = 'edit it'
    chat.submit(around)
    const id = String(chat.thread?.id)
    await vi.waitFor(() => expect(chat.states.get(id)).toBe('needs-input'))
    release()
    await vi.waitFor(() => expect(chat.states.get(id)).toBe('done'))
  })

  test('archived once archived, and done again once brought back', async () => {
    const plan = await had('work', 'Plan', 1_000)
    const chat = await opened()
    await vi.waitFor(() => expect(chat.heads).toHaveLength(1))
    chat.archive(plan.id)
    await vi.waitFor(() => expect(chat.states.get(plan.id)).toBe('archived'))
    chat.unarchive(plan.id)
    await vi.waitFor(() => expect(chat.states.get(plan.id)).toBe('done'))
  })

  test('interrupted, after a launch, where it was at work when the app closed', async () => {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.turns = [{ id: 'u', role: 'you', at: 1, parts: [] }]
    thread.state = 'running'
    await keepThread(thread)
    const chat = await opened()
    await vi.waitFor(() => expect(chat.states.get(thread.id)).toBe('interrupted'))
  })

  test('pinned to the top, and kept so', async () => {
    const plan = await had('work', 'Plan', 1_000)
    const chat = await opened()
    await vi.waitFor(() => expect(chat.heads).toHaveLength(1))
    await chat.pin(plan.id)
    expect(chat.heads[0]?.pinned).toBeGreaterThan(0)
    const again = await opened()
    await vi.waitFor(() => expect(again.heads[0]?.pinned).toBeGreaterThan(0))
    await again.pin(plan.id, false)
    expect(again.heads[0]?.pinned).toBeUndefined()
  })
})

describe('switching a chat to another model', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
    ticking.asked.length = 0
    ticking.answer = { id: 'switch', ticked: false }
  })

  async function long() {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    const thread = chat.ensure()
    thread.usage = { ...thread.usage, input: 50_000, output: 1_000 }
    return { chat, thread }
  }

  test('asks first on a long chat, and switches on yes', async () => {
    const { chat, thread } = await long()
    await chat.chooseModel('p', 'other')
    expect(ticking.asked).toHaveLength(1)
    expect(thread.model).toBe('other')
  })

  test('switches nothing on no', async () => {
    const { chat, thread } = await long()
    ticking.answer = { id: 'cancel', ticked: false }
    await chat.chooseModel('p', 'other')
    expect(thread.model).toBe('m')
  })

  test('asks no more once told not to', async () => {
    const { chat } = await long()
    ticking.answer = { id: 'switch', ticked: true }
    await chat.chooseModel('p', 'other')
    await chat.chooseModel('p', 'third')
    expect(ticking.asked).toHaveLength(1)
  })

  test('asks first by /model, and switches nothing on no', async () => {
    const { chat, thread } = await long()
    chat.models = { p: [{ id: 'other', name: 'Other' } as never] }
    ticking.answer = { id: 'cancel', ticked: false }
    expect(chat.modelNamed('other')).toBe(true)
    await vi.waitFor(() => expect(ticking.asked).toHaveLength(1))
    expect(thread.model).toBe('m')
  })

  test('asks first by Ask again with another model, and asks nothing again on no', async () => {
    const { chat, thread } = await long()
    thread.turns = [
      { id: 'u', role: 'you', at: 1, parts: [], draft: { text: 'go', attachments: [] } },
      { id: 'a', role: 'model', at: 1, parts: [] },
    ]
    engine.send.mockClear()
    ticking.answer = { id: 'cancel', ticked: false }
    chat.retry({ provider: 'p', id: 'other' })
    await vi.waitFor(() => expect(ticking.asked).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(thread.model).toBe('m')
    expect(engine.send).not.toHaveBeenCalled()
  })

  test('and asks again with the new model once the switch is taken', async () => {
    const { chat, thread } = await long()
    thread.turns = [
      { id: 'u', role: 'you', at: 1, parts: [], draft: { text: 'go', attachments: [] } },
      { id: 'a', role: 'model', at: 1, parts: [] },
    ]
    engine.send.mockClear()
    chat.retry({ provider: 'p', id: 'other' })
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalled())
    expect(thread.model).toBe('other')
  })

  test('and never on a short one', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    chat.ensure()
    await chat.chooseModel('p', 'other')
    expect(ticking.asked).toEqual([])
    expect(chat.thread?.model).toBe('other')
  })
})

describe('where a chat stands', () => {
  beforeEach(() => {
    kept.clear()
    localStorage.clear()
    engine.send.mockReset()
  })

  async function answering() {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    let tell: (part: Part, index: number) => void = () => undefined
    let finish: () => void = () => undefined
    engine.send.mockImplementationOnce(
      (thread: Thread, draft: Draft, on: (event: EngineEvent) => void) =>
        new Promise<void>((resolve) => {
          const turn: Turn = { id: 'answer', role: 'model', at: 1, parts: [] }
          thread.turns.push({ id: 'asked', role: 'you', at: 1, parts: [], draft }, turn)
          on({ type: 'turn', turn })
          tell = (part, index) => {
            turn.parts[index] = part
            on({ type: 'part', turn: turn.id, index, part })
          }
          finish = resolve
        }),
    )
    chat.text = 'go on'
    chat.submit({ front: null, selection: '' })
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    return { chat, tell: (part: Part, index: number) => tell(part, index), end: () => finish() }
  }

  const call = (id: string, state: 'asking' | 'ok' | 'running'): Part => ({
    kind: 'tool',
    id,
    verb: 'write',
    args: {},
    state,
  })

  test('a call finishing beside one awaiting approval leaves it waiting on the reader', async () => {
    const { chat, tell, end } = await answering()
    tell(call('one', 'running'), 0)
    tell(call('two', 'running'), 1)
    expect(chat.thread?.state).toBe('running')
    tell(call('one', 'asking'), 0)
    expect(chat.thread?.state).toBe('needs-input')
    tell(call('two', 'ok'), 1)
    expect(chat.thread?.state).toBe('needs-input')
    tell(call('one', 'ok'), 0)
    expect(chat.thread?.state).toBe('running')
    end()
  })

  test('so does one of two approvals answered, until the other is', async () => {
    const { chat, tell, end } = await answering()
    tell(call('one', 'asking'), 0)
    tell(call('two', 'asking'), 1)
    tell(call('one', 'ok'), 0)
    expect(chat.thread?.state).toBe('needs-input')
    tell(call('two', 'ok'), 1)
    expect(chat.thread?.state).toBe('running')
    end()
  })

  test('a chat a relaunch found at work is interrupted, and at work again when asked', async () => {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.title = 'Plan'
    thread.state = 'running'
    thread.turns = [{ id: 'u1', role: 'you', at: 1, parts: [] }]
    await keepThread(thread)

    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.every.map((one) => one.state)).toEqual(['interrupted']))
    await chat.openThread(thread.id, false)
    expect(chat.thread?.state).toBe('interrupted')

    let finish: () => void = () => undefined
    engine.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    chat.text = 'again'
    chat.submit({ front: null, selection: '' })
    await vi.waitFor(() => expect(chat.every.map((one) => one.state)).toEqual(['running']))
    await vi.waitFor(() => expect(engine.send).toHaveBeenCalledTimes(1))
    finish()
    await vi.waitFor(() => expect(chat.running).toEqual([]))
  })

  test('a chat another window is answering in is at work, not interrupted', async () => {
    const { keepThread, newThread } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.title = 'Plan'
    thread.state = 'running'
    thread.answering = 'a1'
    thread.turns = [{ id: 'u1', role: 'you', at: 1, parts: [] }]
    await keepThread(thread)

    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() =>
      expect(chat.every.find((one) => one.id === thread.id)?.state).toBe('running'),
    )
  })

  test('so is one of those in hand here, opened or asked after', async () => {
    const { claimAnswer, keepThread, newThread, unclaimAnswer } = await import('../chat/threads')
    const thread = newThread('work', 'p', 'm')
    thread.title = 'Plan'
    thread.state = 'running'
    thread.answering = 'a1'
    thread.turns = [{ id: 'u1', role: 'you', at: 1, parts: [] }]
    expect(await claimAnswer(thread.id)).toBe(true)
    onTestFinished(() => unclaimAnswer(thread.id))
    await keepThread(thread)

    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.every.map((one) => one.id)).toEqual([thread.id]))
    await chat.openThread(thread.id, false)
    expect(chat.every.find((one) => one.id === thread.id)?.state).toBe('running')
    chat.showThreads()
    await new Promise((done) => setTimeout(done, 0))
    expect(chat.every.find((one) => one.id === thread.id)?.state).toBe('running')
  })
})

describe('a chat in the list the moment it changes (#1111)', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
  })

  function holding() {
    let answer: () => void = () => undefined
    engine.send.mockImplementationOnce((thread: Thread, draft: Draft, on) => {
      const turn = { id: crypto.randomUUID(), role: 'you' as const, at: 1, parts: [], draft }
      thread.turns.push(turn)
      on({ type: 'turn', turn })
      return new Promise<void>((done) => {
        answer = done
      })
    })
    return () => answer()
  }

  test('is there at once when it is made and left with Back, the answer still to come', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.head).not.toBeNull())
    const answer = holding()
    chat.text = 'plan the week'
    chat.submit({ front: null, selection: '' })
    const id = chat.thread?.id ?? ''
    await vi.waitFor(() => expect(chat.head?.kept).toBe(true))

    chat.newThread()
    expect(chat.heads.map((one) => one.id)).toEqual([id])
    chat.showThreads()
    await new Promise((done) => setTimeout(done, 0))
    expect(chat.heads.map((one) => one.id)).toEqual([id])
    answer()
    await vi.waitFor(() => expect(chat.running).toEqual([]))
    expect(chat.heads.map((one) => one.id)).toEqual([id])
  })

  test('is there at once while its first message is still gathered', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    let open: () => void = () => undefined
    gathering.gate = new Promise((done) => {
      open = done
    })
    chat.text = 'plan the week'
    chat.submit({ front: null, selection: '' })

    expect(chat.heads.map((one) => one.id)).toEqual([chat.thread?.id])
    open()
    await vi.waitFor(() => expect(chat.running).toEqual([]))
  })

  test('started from elsewhere is there at once', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    const aside = chat.startAside('home', 'Book the dentist', 'auto', 'Do this task')

    expect(chat.heads.map((one) => one.title)).toEqual(['Book the dentist'])
    await aside
  })

  test('renamed, pinned, archived and deleted, is so in the list at once', async () => {
    const garden = await had('home', 'Garden', 1_000)
    const plan = await had('work', 'Plan', 2_000)
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    await vi.waitFor(() => expect(chat.heads).toHaveLength(2))
    const line = (id: string) => chat.heads.find((one) => one.id === id)

    await chat.rename('Allotment', garden.id)
    expect(line(garden.id)?.title).toBe('Allotment')

    chat.showThreads()
    await chat.pin(plan.id)
    await new Promise((done) => setTimeout(done, 0))
    expect(line(plan.id)?.pinned).toBeGreaterThan(0)

    chat.archive(garden.id)
    await vi.waitFor(() => expect(line(garden.id)?.archived).toBe(true))

    const removing = chat.remove(plan.id)
    await vi.waitFor(() => expect(line(plan.id)).toBeUndefined())
    await removing
    expect(line(plan.id)).toBeUndefined()
  })
})

describe('a chat started outside the panel', () => {
  beforeEach(() => {
    kept.clear()
    deleted.length = 0
    localStorage.clear()
    place.activeSpaceId = 'work'
  })

  test('is a chat like one typed into the panel: its engine, its provider, what was in front', async () => {
    engine.send.mockClear()
    const chat = await launched()
    chat.here('work')
    chat.know(['work', 'home'])
    const front = { path: 'Plan.md', name: 'Plan', text: 'ship on Friday' }

    const { thread, ended } = chat.startHere('When do we ship?', [], {
      front,
      selection: '',
      picked: null,
    })
    await ended

    const [sent, draft] = engine.send.mock.calls[0] ?? []
    expect(sent).toBe(thread)
    expect([thread.space, thread.provider, thread.model]).toEqual(['work', 'p', 'm'])
    expect(draft?.text).toBe('When do we ship?')
    expect(draft?.attachments.map((one) => one.text)).toContain('ship on Friday')
    expect(kept.get('work')?.has(thread.id)).toBe(true)
  })

  test('is in the list at once, and the chat open in the panel stays open', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    await vi.waitFor(() => expect(chat.head).not.toBeNull())
    const open = chat.thread
    let gate: () => void = () => undefined
    gathering.gate = new Promise((done) => {
      gate = done
    })

    const { thread, ended } = chat.startHere('When do we ship?', [], {
      front: null,
      selection: '',
      picked: null,
    })

    expect(chat.heads.map((one) => one.id)).toEqual([thread.id])
    expect(chat.thread).toBe(open)
    gate()
    await ended
    expect(chat.heads.map((one) => one.id)).toEqual([thread.id])
  })

  test('learns the spaces itself where the panel was never drawn', async () => {
    const chat = await launched()
    const { thread, ended } = chat.startHere('Hello', [], {
      front: null,
      selection: '',
      picked: null,
    })
    expect(thread.space).toBe('work')
    expect(chat.heads.map((one) => one.id)).toEqual([thread.id])
    await ended
  })

  test('is drawn where it is watched, and a follow-up goes on in it', async () => {
    const chat = await launched()
    chat.here('work')
    chat.know(['work'])
    const { thread, ended } = chat.startHere('First', [], {
      front: null,
      selection: '',
      picked: null,
    })
    chat.watch(thread)
    await ended
    await vi.waitFor(() => expect(chat.watched?.turns.length).toBe(2))

    await chat.sendIn(thread, 'Second', [], { front: null, selection: '', picked: null })
    await vi.waitFor(() => expect(chat.watched?.turns.length).toBe(4))
    expect(chat.watched?.turns[2]?.draft?.text).toBe('Second')
    chat.watch(null)
    expect(chat.watched).toBeNull()
  })
})
