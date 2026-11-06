/** Threads kept: written and read back whole, checked on the way in, branched, and
 *  written one write at a time. The crate's half is ai_threads.rs's tests. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** What the crate holds, by space and id, and every write it was asked for. */
const disk = new Map<string, { head: unknown; body: string }>()
const writes: string[] = []
let slowly: Promise<void> = Promise.resolve()

vi.mock('../../tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: async (command: string, args: Record<string, unknown>) => {
    const key = `${String(args.space)}/${String(args.id)}`
    switch (command) {
      case 'ai_thread_write':
        await slowly
        writes.push(String(args.body))
        disk.set(key, { head: args.head, body: String(args.body) })
        return null
      case 'ai_thread_read':
        return disk.get(key)?.body ?? null
      case 'ai_threads_list':
        return [...disk.entries()]
          .filter(([at]) => at.startsWith(`${String(args.space)}/`))
          .map(([, one]) => one.head)
      case 'ai_thread_delete':
        disk.delete(key)
        return null
      case 'ai_threads_forget':
        for (const at of [...disk.keys()])
          if (at.startsWith(`${String(args.space)}/`)) disk.delete(at)
        return null
      default:
        throw new Error(command)
    }
  },
}))

vi.mock('../../windows', async (original) => {
  const { Windows } = await original<typeof import('../../windows')>()
  const ends: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null
    postMessage(m: unknown): void
  }[] = []
  const end = () => {
    const line = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: (message: unknown) => {
        for (const one of ends) {
          if (one !== line) one.onmessage?.({ data: message } as MessageEvent<unknown>)
        }
      },
    }
    ends.push(line)
    return line
  }
  const [mine, theirs] = [end(), end()]
  return { Windows, windows: new Windows(() => mine), other: new Windows(() => theirs) }
})

const { other } = (await import('../../windows')) as unknown as {
  other: import('../../windows').Windows
}

const {
  branchThread,
  chatsOf,
  deleteThread,
  findParents,
  forgetSpace,
  headOf,
  keepThread,
  listThreads,
  newThread,
  readThread,
  threadIn,
  unreadOf,
  writeThread,
} = await import('./threads')
const choices = await import('./choices')

import type { Thread } from './types'

function had(): Thread {
  const thread = newThread('space-1', 'anthropic', 'claude-opus-5-5', 'high', 'full')
  thread.title = 'Herons'
  thread.turns = [
    {
      id: 'y1',
      role: 'you',
      at: 1,
      draft: { text: 'What is in Birds.md?', attachments: [] },
      parts: [],
      effort: 'high',
    },
    {
      id: 'm1',
      role: 'model',
      at: 2,
      model: 'claude-opus-5-5',
      parts: [
        { kind: 'thinking', text: 'hm', ms: 40 },
        {
          kind: 'tool',
          id: 't1',
          verb: 'read_note',
          args: { path: 'Birds.md' },
          state: 'ok',
          result: { text: 'A', images: [], error: false },
        },
        { kind: 'text', text: 'Herons stand still.' },
      ],
      replay: {
        api: 'anthropic',
        model: 'claude-opus-5-5',
        messages: [{ role: 'assistant', content: [{ type: 'thinking', signature: 's' }] }],
      },
    },
    { id: 'y2', role: 'you', at: 3, draft: { text: 'And then?', attachments: [] }, parts: [] },
  ]
  thread.compaction = {
    upTo: 'm1',
    kind: 'anthropic',
    model: 'claude-opus-5-5',
    summary: 'so far',
    block: { type: 'compaction' },
  }
  thread.usage = { input: 3_000, cached: 1_000, output: 20, reasoning: 0, window: 1_000_000 }
  return thread
}

beforeEach(() => {
  disk.clear()
  writes.length = 0
  slowly = Promise.resolve()
})

describe('a thread kept', () => {
  test('reads back as it was written, the provider’s own record and all', async () => {
    const thread = had()
    await writeThread(thread)
    expect(await readThread('space-1', thread.id)).toEqual(thread)
    expect(await readThread('space-1', 'nobody')).toBeNull()
  })

  test('is listed newest first by its head, which carries its words for the search', async () => {
    const older = { ...had(), updated: 1 }
    const newer = { ...had(), id: 'newer', title: 'Egrets', updated: 2 }
    await writeThread(older)
    await writeThread(newer)
    const heads = await listThreads('space-1')
    expect(heads.map((one) => one.title)).toEqual(['Egrets', 'Herons'])
    expect(heads[0]?.words).toBe('What is in Birds.md? Herons stand still. And then?')
    expect(await listThreads('space-2')).toEqual([])
  })

  test('goes with its space, and no other space’s does', async () => {
    const here = had()
    const there = { ...had(), id: 'there', space: 'space-2' }
    await writeThread(here)
    await writeThread(there)
    await forgetSpace('space-1')
    expect(await listThreads('space-1')).toEqual([])
    expect(await readThread('space-2', 'there')).not.toBeNull()
  })

  test('is gone once deleted', async () => {
    const thread = had()
    await writeThread(thread)
    await deleteThread('space-1', thread.id)
    expect(await readThread('space-1', thread.id)).toBeNull()
  })

  test('is kept on this device, which is the fourth question’s default', () => {
    expect(choices.THREADS_SYNCED).toBe(false)
    expect(choices.ASK_IS_A_MODE).toBe(true)
    expect(choices.READER_TABS).toBe(true)
  })
})

describe('a file read back', () => {
  test('that is not a thread is no thread', () => {
    expect(threadIn(null)).toBeNull()
    expect(threadIn({ id: 'x' })).toBeNull()
    expect(threadIn('a thread')).toBeNull()
  })

  test('written in Ask, which Approve replaced, reads as Approve, and keeps its Always', () => {
    const read = threadIn({
      id: 't',
      space: 's',
      provider: 'openai',
      model: 'gpt-5.5',
      mode: 'ask',
      always: ['edit_note', 3],
      turns: [],
    })
    expect(read).toMatchObject({ mode: 'approve', always: ['edit_note'] })
  })

  test('keeps the tools a task done with AI was not given, after a restart too', () => {
    const read = threadIn({
      id: 't',
      space: 's',
      provider: 'openai',
      model: 'gpt-5.5',
      mode: 'auto',
      without: ['browser_open', 7, 'write_note'],
      turns: [],
    })
    expect(read?.without).toEqual(['browser_open', 'write_note'])
    expect(
      threadIn({ id: 't', space: 's', provider: 'openai', model: 'm', turns: [] }),
    ).not.toHaveProperty('without')
  })

  test('keeps what it can read and leaves out what it cannot', () => {
    const read = threadIn({
      id: 't',
      space: 's',
      provider: 'openai',
      model: 'gpt-5.5',
      effort: 'ludicrous',
      mode: 'yolo',
      turns: [
        {
          id: 'a',
          role: 'model',
          parts: [
            { kind: 'text', text: 'ok' },
            { kind: 'hologram' },
            { kind: 'tool', id: 'c', verb: 'read_note', state: 'running' },
          ],
        },
        { id: 'b', role: 'narrator', parts: [] },
        'nonsense',
      ],
    })
    expect(read).toMatchObject({ effort: 'auto', mode: 'approve', title: '' })
    expect(read).not.toHaveProperty('always')
    expect(read?.turns).toHaveLength(1)
    // A call still running when the thread was written never answered.
    expect(read?.turns[0]?.parts).toEqual([
      { kind: 'text', text: 'ok' },
      { kind: 'tool', id: 'c', verb: 'read_note', args: {}, state: 'error' },
    ])
  })
})

describe('a thread on a send’s own mode', () => {
  test('is written and copied with its own', async () => {
    const thread = newThread('work', 'p', 'm', 'auto', 'approve')
    thread.turns = [{ id: 'y1', role: 'you', at: 1, parts: [] }]
    thread.answering = 'y1'
    Object.assign(thread, {
      own: { mode: 'approve', model: 'm', effort: 'auto' },
      mode: 'auto',
      model: 'other',
    })
    await keepThread(thread)

    const read = await readThread('work', thread.id)
    expect(read).toMatchObject({ mode: 'approve', model: 'm' })
    expect(read).not.toHaveProperty('own')

    const copy = branchThread(thread, 'y1')
    expect(copy).toMatchObject({ mode: 'approve', model: 'm' })
    expect(copy).not.toHaveProperty('own')
    expect(copy).not.toHaveProperty('answering')
  })
})

describe('a file written while its answer was on its way', () => {
  const cutOff = (parts: unknown[]) =>
    threadIn({
      ...newThread('work', 'p', 'm'),
      answering: 'm1',
      turns: [
        { id: 'y1', role: 'you', at: 1, parts: [] },
        { id: 'm1', role: 'model', at: 2, parts },
      ],
    })

  test('keeps the words, the calls and what they changed, and says the answer stopped', () => {
    const change = { path: 'Birds.md', added: 2, removed: 1 }
    const read = cutOff([
      { kind: 'text', text: 'Herons' },
      { kind: 'tool', id: 'c', verb: 'edit_note', args: {}, state: 'ok', change },
      { kind: 'tool', id: 'd', verb: 'edit_note', args: {}, state: 'running' },
    ])

    expect(read?.turns[1]?.parts).toEqual([
      { kind: 'text', text: 'Herons' },
      { kind: 'tool', id: 'c', verb: 'edit_note', args: {}, state: 'ok', change },
      { kind: 'tool', id: 'd', verb: 'edit_note', args: {}, state: 'error' },
      { kind: 'notice', code: 'stopped', text: '' },
    ])
  })

  test('does not say so twice, or carry the mark on', () => {
    const read = cutOff([{ kind: 'notice', code: 'error', text: 'Refused' }])

    expect(read?.turns[1]?.parts).toHaveLength(1)
    expect(read).not.toHaveProperty('answering')
  })

  test('says nothing of an answer that is not there', () => {
    const read = threadIn({
      ...newThread('work', 'p', 'm'),
      answering: 'gone',
      turns: [{ id: 'y1', role: 'you', at: 1, parts: [] }],
    })

    expect(read?.turns[0]?.parts).toEqual([])
  })
})

describe('whether anybody is answering is asked, not read off the clock', () => {
  const inFile = (thread: Thread) => {
    disk.set(`work/${thread.id}`, {
      head: {},
      body: JSON.stringify({ ...thread, answeringAt: Date.now(), answeringIn: 'gone' }),
    })
  }
  const answeringOne = () => {
    const thread = newThread('work', 'p', 'm')
    thread.turns = [{ id: 'm1', role: 'model', at: 2, parts: [{ kind: 'text', text: 'Her' }] }]
    thread.answering = 'm1'
    return thread
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a window that says nothing has gone, and the thread can be written again', async () => {
    const thread = answeringOne()
    inFile(thread)
    const reading = readThread('work', thread.id)
    await vi.advanceTimersByTimeAsync(2_000)
    const read = await reading

    expect(read?.elsewhere).toBeUndefined()
    expect(read?.turns[0]?.parts.at(-1)).toEqual({ kind: 'notice', code: 'stopped', text: '' })
    const before = writes.length
    if (read) await keepThread(read)
    expect(writes).toHaveLength(before + 1)
  })

  test('a window that says so is left to answer, and takes the name given here', async () => {
    const thread = answeringOne()
    inFile(thread)
    const stop = other.hear('thread-answering?', (said) =>
      other.say('thread-answering', { id: said.id }),
    )
    const named: unknown[] = []
    const stopNamed = other.hear('thread-fields', (said) => named.push(said.fields))
    const reading = readThread('work', thread.id)
    await vi.advanceTimersByTimeAsync(2_000)
    const read = await reading
    expect(read?.elsewhere).toBe(true)

    const before = writes.length
    if (read) await keepThread({ ...read, title: 'Herons' })
    expect(writes).toHaveLength(before)
    expect(named).toHaveLength(1)
    expect(named[0]).toEqual({ title: 'Herons' })
    stop()
    stopNamed()
  })
})

describe('a file another window is still answering in', () => {
  const answered = (at: number, by = 'another window') =>
    threadIn({
      ...newThread('work', 'p', 'm'),
      answering: 'm1',
      answeringAt: at,
      answeringIn: by,
      turns: [
        { id: 'y1', role: 'you', at: 1, parts: [] },
        { id: 'm1', role: 'model', at: 2, parts: [{ kind: 'text', text: 'Herons' }] },
      ],
    })

  test('says no Stopped while it was written lately, and is not written from here', async () => {
    const read = answered(Date.now())
    if (!read) throw new Error('no thread')

    expect(read.turns[1]?.parts).toEqual([{ kind: 'text', text: 'Herons' }])
    expect(read.elsewhere).toBe(true)

    const before = writes.length
    await keepThread(read)
    expect(writes).toHaveLength(before)
  })

  test('is one the window went on once it has long gone quiet', () => {
    const read = answered(Date.now() - 10 * 60_000)

    expect(read?.turns[1]?.parts.at(-1)).toEqual({ kind: 'notice', code: 'stopped', text: '' })
    expect(read?.elsewhere).toBeUndefined()
  })

  test('written by this window before a reload is over at once', async () => {
    const thread = newThread('work', 'p', 'm')
    thread.turns = [{ id: 'm1', role: 'model', at: 2, parts: [] }]
    thread.answering = 'm1'
    await keepThread(thread)

    const read = await readThread('work', thread.id)
    expect(read?.turns[0]?.parts).toEqual([{ kind: 'notice', code: 'stopped', text: '' }])
    expect(read?.elsewhere).toBeUndefined()
  })

  test('says when and where it was written, and only while it is answering', async () => {
    const thread = newThread('work', 'p', 'm')
    thread.turns = [{ id: 'm1', role: 'model', at: 2, parts: [] }]
    thread.answering = 'm1'
    await keepThread(thread)
    const body = JSON.parse(writes.at(-1) ?? '{}') as Record<string, unknown>
    expect(typeof body.answeringAt).toBe('number')
    expect(typeof body.answeringIn).toBe('string')

    delete thread.answering
    await keepThread(thread)
    expect(JSON.parse(writes.at(-1) ?? '{}')).not.toHaveProperty('answeringAt')
  })
})

describe('a branch', () => {
  test('is a copy up to a turn under a new id, with the compaction only if it is in it', () => {
    const thread = had()
    const whole = branchThread(thread, 'y2', 'Herons again')
    expect(whole.id).not.toBe(thread.id)
    expect(whole.turns.map((one) => one.id)).toEqual(['y1', 'm1', 'y2'])
    expect(whole.compaction?.upTo).toBe('m1')
    expect(whole.title).toBe('Herons again')

    const early = branchThread(thread, 'y1')
    expect(early.turns.map((one) => one.id)).toEqual(['y1'])
    expect(early).not.toHaveProperty('compaction')
    early.turns.push({ id: 'z', role: 'you', at: 0, parts: [] })
    expect(thread.turns).toHaveLength(3)
  })

  test('its head is what the list draws', () => {
    expect(headOf(had())).toMatchObject({
      title: 'Herons',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    })
  })
})

describe('writing while a write is on its way', () => {
  test('is one more write, with the thread as it is by then', async () => {
    let release: () => void = () => undefined
    slowly = new Promise((go) => {
      release = go
    })
    const thread = had()
    const first = keepThread(thread)
    thread.title = 'one'
    void keepThread(thread)
    thread.title = 'two'
    const last = keepThread(thread)
    release()
    await Promise.all([first, last])
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1] ?? '{}')).toMatchObject({ title: 'two' })
  })

  test('is the newest thread asked for, where it came as another object', async () => {
    let release: () => void = () => undefined
    slowly = new Promise((go) => {
      release = go
    })
    const thread = had()
    const first = keepThread(thread)
    const last = keepThread({ ...thread, title: 'read again from the other window' })
    release()
    await Promise.all([first, last])
    expect(JSON.parse(writes.at(-1) ?? '{}')).toMatchObject({
      title: 'read again from the other window',
    })
  })
})

describe('a helper’s thread (#1062)', () => {
  test('says whose it is, in its head too, and a file says so back', async () => {
    const thread = { ...had(), parent: 'p-1' }
    expect(headOf(thread)).toMatchObject({ parent: 'p-1' })
    await keepThread(thread)
    expect((await readThread('space-1', thread.id))?.parent).toBe('p-1')
    expect((await listThreads('space-1'))[0]).toMatchObject({ parent: 'p-1' })
    expect(threadIn({ ...thread, parent: 7 })).not.toHaveProperty('parent')
  })

  test('is in no list while its parent is, and in the list once it is gone', () => {
    const heads = [
      { ...headOf(had()), id: 'a' },
      { ...headOf(had()), id: 'b', parent: 'a' },
      { ...headOf(had()), id: 'c', parent: 'b' },
      { ...headOf(had()), id: 'd', parent: 'gone' },
    ]
    expect(chatsOf(heads).map((one) => one.id)).toEqual(['a', 'd'])
  })

  test('a branch of it is the reader’s own chat', () => {
    expect(branchThread({ ...had(), parent: 'p-1' }, 'y2')).not.toHaveProperty('parent')
  })

  test('the step that started it keeps its id through a file', () => {
    const thread = had()
    thread.turns.push({
      id: 'm2',
      role: 'model',
      at: 4,
      parts: [
        {
          kind: 'tool',
          id: 't2',
          verb: 'run_agent',
          args: {},
          state: 'ok',
          result: { text: 'done', images: [], error: false, agent: 'h-1' },
        },
        { kind: 'notice', code: 'command', text: '↳ check', threads: ['h-2', 4] as string[] },
      ],
    })
    const back = threadIn(JSON.parse(JSON.stringify(thread)))
    expect(back?.turns.at(-1)?.parts).toEqual([
      expect.objectContaining({ result: expect.objectContaining({ agent: 'h-1' }) }),
      { kind: 'notice', code: 'command', text: '↳ check', threads: ['h-2'] },
    ])
  })

  test('kept before helpers said whose they were is told its parent, not a fork', async () => {
    const parent = { ...had(), title: 'Serie 6' }
    const helper = { ...newThread('space-1', 'a', 'm'), title: '↳ Aufgabe 5' }
    const deeper = { ...newThread('space-1', 'a', 'm'), title: '↳ Aufgabe 5b' }
    const fork = { ...newThread('space-1', 'a', 'm'), title: 'Serie 6' }
    await keepThread({ ...parent, helpers: [helper.id, deeper.id, fork.id] } as Thread)
    await keepThread({ ...helper, helpers: [deeper.id] } as Thread)
    await keepThread(deeper)
    await keepThread(fork)

    expect(await findParents('space-1')).toBe(2)
    expect((await readThread('space-1', helper.id))?.parent).toBe(parent.id)
    expect((await readThread('space-1', deeper.id))?.parent).toBe(helper.id)
    expect((await readThread('space-1', fork.id))?.parent).toBeUndefined()
    expect(await findParents('space-1')).toBe(0)
  })
})

describe('a chat’s unread mark (#1064)', () => {
  test('is kept with the thread and its head, and a file says it back', async () => {
    const thread = { ...had(), answered: 20, seen: 10 }
    expect(headOf(thread)).toMatchObject({ answered: 20, seen: 10 })
    await keepThread(thread)
    expect(await readThread('space-1', thread.id)).toMatchObject({ answered: 20, seen: 10 })
    expect((await listThreads('space-1'))[0]).toMatchObject({ answered: 20, seen: 10 })
    expect(threadIn({ ...thread, answered: 'soon' })).not.toHaveProperty('answered')
  })

  test('is on a chat answered since it was seen, its helpers’ answers counted in it', () => {
    const head = (id: string, more: object) => ({ ...headOf(had()), id, ...more })
    const heads = [
      head('read', { answered: 10, seen: 20 }),
      head('new', { answered: 30, seen: 20 }),
      head('never', { answered: 5 }),
      head('quiet', {}),
      head('parent', { answered: 10, seen: 20 }),
      head('helper', { parent: 'parent', answered: 25, seen: 0 }),
      head('deeper', { parent: 'helper', answered: 15 }),
      head('orphan', { parent: 'gone', answered: 3 }),
    ]
    expect([...unreadOf(heads)].sort()).toEqual(['never', 'new', 'orphan', 'parent'])
  })
})
