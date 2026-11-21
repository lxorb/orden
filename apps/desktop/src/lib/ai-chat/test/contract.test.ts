import { describe, expect, test, vi } from 'vitest'
import { askPart, chatReplies, chatsUnread, helperRun, lookAtLaunch, type Panel } from '../src/api'

const LOCAL = {
  id: 'compatible-1',
  kind: 'compatible',
  name: 'Ollama',
  model: 'llama',
  baseUrl: 'http://x',
} as const
const world = vi.hoisted((): { parent: unknown; children: unknown[] } => ({ parent: null, children: [] }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    active: null,
    spaces: [{ id: 'Notes', root: '/n' }],
    activeSpace: { id: 'Notes' },
    activeSpaceId: 'Notes',
    notes: [],
    documents: [],
    leftOutOf: () => [],
    noteText: () => Promise.resolve(null),
  },
  agentMarks: { open: null },
}))
vi.mock('../../gates/src/api', () => ({ chatsOn: () => true }))
const programs = vi.hoisted(() => ({ released: [] as string[] }))
vi.mock('../src/store/setup', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  engineOf: () =>
    Promise.resolve({
      models: () => Promise.resolve([]),
      send: () => Promise.resolve(),
      steer: () => Promise.resolve(false),
      compact: () => Promise.resolve(),
      release: (thread: { id: string }) => void programs.released.push(thread.id),
    }),
}))
const providerFetched = vi.hoisted(() => [] as string[])
const invoked = vi.hoisted(() => [] as { command: string; args: Record<string, unknown> }[])
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    invoked.push({ command, args })
    if (command === 'ai_cli_open') programLine.out = args.output as { onmessage: (value: unknown) => void }
    if (command === 'ai_cli_say' && (args.say as { kind?: string }).kind === 'turn') {
      setTimeout(() => {
        for (const line of PROGRAM_ANSWER) programLine.out?.onmessage({ kind: 'line', line })
      }, 0)
    }
    return Promise.resolve({ content: [], isError: false })
  },
}))
const programLine = vi.hoisted(() => ({ out: null as { onmessage: (value: unknown) => void } | null }))
const PROGRAM_ANSWER = vi.hoisted(() => [
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Herons wait.' } },
  }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
])
vi.mock('../../crate/src/native', () => ({
  Channel: class {
    onmessage: (value: unknown) => void = () => undefined
  },
}))
vi.mock('../../ai-providers/src/keys', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readKey: () => Promise.resolve('sk-test'),
}))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  providerFetch: (url: string, init?: RequestInit) => {
    providerFetched.push(url)
    return fetch(url, init)
  },
  ai: (() => {
    const local = { id: 'compatible-1', kind: 'compatible', name: 'Ollama', model: 'llama', baseUrl: 'http://x' }
    return { providers: [local], provider: () => local, providerFor: () => local }
  })(),
  usable: () => true,
}))
const rewinds = vi.hoisted(() => [] as unknown[])
vi.mock('../src/review/index', () => ({
  editMessage: () => Promise.resolve(),
  lastMessage: () => null,
  openRewind: (...args: unknown[]) => void rewinds.push(args),
}))
vi.mock('../src/commands/found', () => ({
  rootOfSpace: () => '/n',
  foundNamed: () => Promise.resolve(null),
  wordsOf: () => Promise.resolve(''),
}))
vi.mock('../src/store/chat.svelte', () => ({
  chat: {
    threadOf: (id: string) => ((world.parent as { id: string } | null)?.id === id ? world.parent : null),
    loadModels: () => Promise.resolve([]),
    adopt: () => undefined,
    turn: (thread: unknown) => {
      world.children.push(thread)
      return Promise.resolve({ stop: 'end', turn: null, usage: null })
    },
  },
}))
describe('the unread mark', () => {
  test('stays off while there is no space to look in', async () => {
    await lookAtLaunch([])
    expect(chatsUnread.any).toBe(false)
  })
  test('is what the Ask panel’s sidebar part says, beside its new chat and threads tools', () => {
    expect(askPart.unread?.()).toBe(false)
    chatsUnread.any = true
    expect(askPart.unread?.()).toBe(true)
    chatsUnread.any = false
    expect(askPart.tools?.map((one) => [one.id, one.label, one.command])).toEqual([
      ['new-chat', 'New chat', undefined],
      ['threads', 'Chats', 'app.ask'],
    ])
    expect(typeof askPart.toTab).toBe('function')
  })
})
describe('a reply drafted for a chat', () => {
  test('sends nothing while no module lends the chats', async () => {
    const { draftReply } = await chatReplies()
    const sent: string[] = []
    const panel = { send: (text: string) => void sent.push(text) } as Partial<Panel> as Panel
    const thread = { id: 't1', turns: [] } as unknown as Parameters<typeof draftReply>[1]
    await expect(draftReply(panel, thread, 'c1', 'say yes')).resolves.toBe(false)
    expect(sent).toEqual([])
  })
})
describe('an answer naming a path on another host', () => {
  const ELSEWHERE = [
    '\\\\server\\share\\a.md',
    '//server/share/a.md',
    '\\/server/share',
    '/\\server\\share',
    '\\\\?\\UNC\\server\\share\\a.md',
    '\\\\.\\UNC\\server\\share',
    'file://server/share/a.md',
    'file:///C:/a.md',
  ]
  test('is never a link, nor placed anywhere, on any system, in words or in code', async () => {
    const { placeOf, withPaths } = await import('../src/store/paths')
    for (const system of ['windows', 'macos', 'linux']) {
      const here = {
        root: system === 'windows' ? 'C:\\Notes' : '/Users/me/Notes',
        system,
        spaces: [{ root: system === 'windows' ? 'C:\\Notes' : '/Users/me/Notes' }],
        holds: () => true,
        opens: () => true,
        reveals: true,
      }
      for (const path of ELSEWHERE) {
        const written = path.replace(/&/g, '&amp;')
        expect(withPaths(`<p>${written}</p><p><code>${written}</code></p>`, here)).not.toContain('data-path')
        expect(placeOf(path, here, system === 'windows' ? 'C:\\Users\\me' : '/Users/me')).toBeNull()
      }
    }
  })
})
describe('a helper', () => {
  test('never reaches a tool its parent chat may not, nor works in a wider mode', async () => {
    const { newThread } = await import('../src/chat/threads')
    const parent = {
      ...newThread('Notes', LOCAL.id, 'llama', 'auto', 'approve'),
      without: ['browser_open', 'edit_note'],
      only: ['read_note', 'edit_note', 'list_tasks'],
    }
    world.parent = parent
    const { runAgent } = await helperRun()
    const said = await runAgent({ prompt: 'Find the herons.' }, { thread: parent.id, mode: 'full' })
    expect(said).not.toHaveProperty('refused')
    const child = world.children[0] as typeof parent
    expect(child.parent).toBe(parent.id)
    expect(child.mode).toBe('approve')
    expect(child.without).toEqual(expect.arrayContaining(['browser_open', 'edit_note']))
    expect(child.only).toEqual(['read_note', 'edit_note', 'list_tasks'])
    const listed: string[][] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (url.includes('/models')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'llama' }] })))
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
        tools?: { function: { name: string } }[]
      }
      listed.push((body.tools ?? []).map((one) => one.function.name))
      const said = [
        { choices: [{ delta: { content: 'Herons.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]
      return Promise.resolve(
        new Response(said.map((one) => `data: ${JSON.stringify(one)}\n\n`).join('') + 'data: [DONE]\n\n'),
      )
    })
    const { createApiEngine } = await import('../src/chat/engine')
    const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object' } })
    const engine = createApiEngine({
      provider: (id) => (id === LOCAL.id ? LOCAL : null),
      tools: {
        list: () =>
          Promise.resolve({
            instructions: '',
            tools: [tool('read_note'), tool('browser_open'), tool('edit_note'), tool('run_terminal')],
          }),
        call: () => Promise.resolve({ text: '', images: [], error: false }),
        context: () => Promise.resolve(''),
      },
    })
    await engine.send(
      child,
      { text: 'Find the herons.', attachments: [] },
      () => undefined,
      new AbortController().signal,
    )
    vi.unstubAllGlobals()
    expect(listed).toEqual([['read_note']])
  })
})
describe('a chat that runs', () => {
  const real = () => vi.importActual<typeof import('../src/store/chat.svelte')>('../src/store/chat.svelte')
  async function opened() {
    const { chat } = await real()
    const { newThread } = await import('../src/chat/threads')
    const thread = newThread('Notes', LOCAL.id, 'llama', 'auto', 'approve')
    thread.turns = [{ id: 'u1', role: 'you', at: 1, parts: [], draft: { text: 'Herons?', attachments: [] } }]
    chat.adopt(thread, true)
    return { chat, thread }
  }
  test('refuses a rewind and a compaction while it answers', async () => {
    const { chat, thread } = await opened()
    rewinds.length = 0
    chat.running = [thread.id]
    expect(chat.answers(thread)).toBe(true)
    const begun = vi.spyOn(chat as unknown as { begin: (thread: unknown) => AbortController }, 'begin')
    chat.rewind('u1')
    chat.compact()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rewinds).toEqual([])
    expect(begun).not.toHaveBeenCalled()
    chat.running = []
    chat.rewind('u1')
    expect(rewinds).toHaveLength(1)
  })
  test.each(['stop', 'archive', 'delete'] as const)(
    'ends on %s all it runs: its loop, its goal, its helpers, one started for it in another window too, and the calls the crate runs for them',
    async (how) => {
      const { chat, thread } = await opened()
      const { tasks } = await import('../src/commands/tasks.svelte')
      const { helpers } = await import('../src/helpers/helpers.svelte')
      const stopped: string[] = []
      for (const kind of ['loop', 'goal'] as const) {
        tasks.add({ thread: thread.id, kind, label: kind, stop: () => void stopped.push(kind) })
      }
      const helped: AbortSignal[] = []
      const started = await helpers.start(
        {
          parent: null,
          asking: thread.id,
          space: 'Notes',
          prompt: 'Look',
          description: 'look',
          model: '',
          mode: 'approve',
        },
        {
          offered: () => Promise.resolve([{ provider: LOCAL, models: [] }]),
          run: (_thread, _text, signal) => {
            helped.push(signal)
            return new Promise(() => undefined)
          },
        },
      )
      expect(started).toMatchObject({ parent: thread.id })
      if ('refused' in started) throw new Error(started.refused)
      invoked.length = 0
      if (how === 'stop') chat.stop()
      if (how === 'archive') chat.archive(thread.id)
      if (how === 'delete') chat.heardDeleted(thread.id)
      await vi.waitFor(() => expect(stopped.sort()).toEqual(['goal', 'loop']))
      await vi.waitFor(() => expect(helped[0]?.aborted).toBe(true))
      const told = invoked.filter((one) => one.command === 'agents_stop').map((one) => one.args.thread)
      expect(told).toContain(started.id)
      if (how !== 'delete') expect(told).toContain(thread.id)
    },
  )
  test('started outside the panel is an Approve chat, whatever mode the panel was last put in', async () => {
    const { chat } = await opened()
    chat.setMode('plan')
    const { thread } = chat.startHere('What does this word mean?', [], { front: null, selection: '' })
    expect(thread.mode).toBe('approve')
  })
})
describe('a helper started for a chat in another window', () => {
  test('keeps out every tool its chat keeps out, uses only what its chat may, and works in its chat’s space', async () => {
    world.parent = null
    world.children.length = 0
    const { runAgent } = await helperRun()
    const said = await runAgent(
      { prompt: 'Find the herons.' },
      {
        thread: 'chat-in-window-2',
        mode: 'approve',
        without: ['edit_note'],
        only: ['read_note', 'edit_note'],
        space: 'Notes',
      },
    )
    expect(said).not.toHaveProperty('refused')
    expect(world.children[0]).toMatchObject({
      parent: 'chat-in-window-2',
      mode: 'approve',
      only: ['read_note', 'edit_note'],
      space: 'Notes',
    })
    expect((world.children[0] as { without?: string[] }).without).toContain('edit_note')
    const refused = await runAgent(
      { prompt: 'Find the herons.' },
      { thread: 'chat-in-window-2', mode: 'approve', space: 'Gone' },
    )
    expect(refused).toHaveProperty('refused')
  })
  test('and every call a chat makes tells the crate what that chat keeps out, may use and works in', async () => {
    const { crateTools } = await import('../src/chat/tools')
    invoked.length = 0
    await crateTools.call(
      LOCAL,
      'approve',
      'edit_note',
      { path: 'a.md' },
      {
        id: 't1',
        space: 'Notes',
        without: ['browser_open'],
        only: ['read_note'],
      },
    )
    expect(invoked.find((one) => one.command === 'ai_agent_call')?.args).toMatchObject({
      thread: 't1',
      space: 'Notes',
      without: ['browser_open'],
      only: ['read_note'],
    })
  })
})
describe('a turn and the failures it survives', () => {
  const words = (content: string) => ({ choices: [{ delta: { content } }] })
  const streamed = (...events: unknown[]) =>
    new Response(events.map((one) => `data: ${JSON.stringify(one)}\n\n`).join(''))
  const finished = () => streamed(words('Herons.'), { choices: [{ delta: {}, finish_reason: 'stop' }] })
  const failed = (status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { message: `refused ${String(status)}` } }), { status, headers })
  async function turn(replies: (() => Response)[], signal = new AbortController().signal) {
    const { pacing } = await import('../src/chat/request')
    const waits: number[] = []
    const sleep = pacing.sleep
    pacing.sleep = (ms, until) => {
      waits.push(ms)
      return ms > 10_000 ? sleep(ms, until) : Promise.resolve()
    }
    const asked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      if (url.includes('/models')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'llama' }] })))
      asked.push(url)
      const next = replies.shift()
      if (!next) return Promise.reject(new Error('asked once too often'))
      return Promise.resolve().then(next)
    })
    const { createApiEngine } = await import('../src/chat/engine')
    const { newThread } = await import('../src/chat/threads')
    const engine = createApiEngine({
      provider: (id) => (id === LOCAL.id ? LOCAL : null),
      tools: {
        list: () => Promise.resolve({ instructions: '', tools: [] }),
        call: () => Promise.resolve({ text: '', images: [], error: false }),
        context: () => Promise.resolve(''),
      },
    })
    const heard: { type: string; stop?: string }[] = []
    try {
      await engine.send(
        newThread('Notes', LOCAL.id, 'llama', 'auto', 'approve'),
        { text: 'Herons?', attachments: [] },
        (event) => heard.push(event),
        signal,
      )
    } finally {
      vi.unstubAllGlobals()
      pacing.sleep = sleep
    }
    return { stop: heard.at(-1)?.stop, asked: asked.length, waits }
  }
  test.each([529, 429, 503, 408, 409])('goes on after a %i that came before any of the answer', async (status) => {
    expect(await turn([() => failed(status), finished])).toMatchObject({ stop: 'end', asked: 2 })
  })
  test('goes on after a network that failed before any of the answer', async () => {
    const unreachable = () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await turn([unreachable, finished])).toMatchObject({ stop: 'end', asked: 2 })
  })
  test.each([400, 401])('ends in an error at once on a %i', async (status) => {
    expect(await turn([() => failed(status), finished])).toMatchObject({ stop: 'error', asked: 1 })
  })
  test('waits as long as the provider says', async () => {
    expect(await turn([() => failed(429, { 'retry-after': '2' }), finished])).toMatchObject({ waits: [2_000] })
  })
  test('ends as stopped, at once and asking nothing more, when stopped while it waits', async () => {
    const stopper = new AbortController()
    setTimeout(() => stopper.abort(), 50)
    const started = Date.now()
    const ended = await turn([() => failed(429, { 'retry-after': '30' }), finished], stopper.signal)
    expect(ended).toMatchObject({ stop: 'stopped', asked: 1 })
    expect(Date.now() - started).toBeLessThan(5_000)
  })
  test('ends in an error, never asked again, when the answer is cut after it began', async () => {
    expect(await turn([() => streamed(words('Her')), finished])).toMatchObject({ stop: 'error', asked: 1 })
  })
})
describe('a helper that ends', () => {
  test('lets its program session go, whether it is done, failed or stopped', async () => {
    await vi.importActual<typeof import('../src/store/chat.svelte')>('../src/store/chat.svelte')
    const { helpers } = await import('../src/helpers/helpers.svelte')
    const ends: ((stop: 'end' | 'error') => void)[] = []
    const roads = {
      offered: () => Promise.resolve([{ provider: LOCAL, models: [] }]),
      run: (_thread: unknown, _text: string, signal: AbortSignal) =>
        new Promise<{ stop: 'end' | 'error' | 'stopped'; turn: null; usage: null }>((done) => {
          ends.push((stop) => done({ stop, turn: null, usage: null }))
          signal.addEventListener('abort', () => done({ stop: 'stopped', turn: null, usage: null }))
        }),
    }
    const ask = {
      parent: null,
      space: 'Notes',
      prompt: 'Look',
      description: 'look',
      model: '',
      mode: 'approve' as const,
    }
    const started = await Promise.all([helpers.start(ask, roads), helpers.start(ask, roads), helpers.start(ask, roads)])
    const ids = started.map((one) => ('id' in one ? one.id : ''))
    ends[0]?.('end')
    ends[1]?.('error')
    helpers.stop(ids[2] ?? '')
    await vi.waitFor(() => expect(programs.released).toEqual(expect.arrayContaining(ids)))
  })
})
describe('what is sent to a model', () => {
  const big = (tokens: number) => 'Herons stand still in the shallows. '.repeat(Math.ceil((tokens * 4) / 36))
  test('every request the API loop sends fits the model’s window, after a tool answer far bigger than it too', async () => {
    const { tokensIn } = await import('../src/chat/window')
    const { createApiEngine } = await import('../src/chat/engine')
    const { newThread } = await import('../src/chat/threads')
    const bodies: unknown[] = []
    const reply = (...events: unknown[]) =>
      new Response(events.map((one) => `data: ${JSON.stringify(one)}\n\n`).join('') + 'data: [DONE]\n\n')
    const replies = [
      () =>
        reply(
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_note', arguments: '{}' } }] } },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ),
      () =>
        reply({ choices: [{ delta: { content: 'Herons.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (url.includes('/models')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'llama' }] })))
      bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}'))
      return Promise.resolve().then(replies.shift() ?? replies[1] ?? (() => new Response('')))
    })
    const engine = createApiEngine({
      provider: (id) => (id === LOCAL.id ? LOCAL : null),
      tools: {
        list: () => Promise.resolve({ instructions: '', tools: [] }),
        call: () => Promise.resolve({ text: big(20_000), images: [], error: false }),
        context: () => Promise.resolve(''),
      },
    })
    const thread = newThread('Notes', LOCAL.id, 'llama', 'auto', 'full')
    thread.usage = { ...thread.usage, window: 8_192 }
    try {
      await engine.send(thread, { text: 'Read it', attachments: [] }, () => undefined, new AbortController().signal)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(bodies).toHaveLength(2)
    for (const body of bodies) expect(tokensIn(body)).toBeLessThan(8_192)
  })
  test('a reopened program session’s seed fits the model’s window, and says what it left out', async () => {
    const { estimateText } = await import('../src/chat/usage')
    const { createLocalEngine } = await import('../src/local/engine')
    const { newThread } = await import('../src/chat/threads')
    const claude = { id: 'cc', kind: 'claude-code', name: 'Claude Code', model: '' } as const
    const engine = createLocalEngine('claude-code', { provider: (id) => (id === claude.id ? claude : null) })
    const thread = newThread('Notes', claude.id, '', 'auto', 'approve')
    thread.usage = { ...thread.usage, window: 20_000 }
    for (let at = 0; at < 40; at++) {
      thread.turns.push({
        id: `u${String(at)}`,
        role: 'you',
        at,
        parts: [],
        draft: { text: `question ${String(at)}`, attachments: [] },
      })
      thread.turns.push({ id: `m${String(at)}`, role: 'model', at, parts: [{ kind: 'text', text: big(1_000) }] })
    }
    invoked.length = 0
    await engine.send(thread, { text: 'and now?', attachments: [] }, () => undefined, new AbortController().signal)
    const said = invoked.find((one) => one.command === 'ai_cli_say')?.args.say as { text?: string } | undefined
    const seed = said?.text ?? ''
    expect(estimateText(seed)).toBeLessThan(20_000)
    expect(seed).toMatch(/\d+ earlier messages are left out to fit the model’s window/)
  })
})
describe('a request to an AI provider', () => {
  test('leaves through providerFetch, and nothing in the module calls fetch itself', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = join(import.meta.dirname, '../src')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return files(path)
        return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
      })
    const bare = files(source).filter((path) => /(?<![\w.])fetch\(/.test(readFileSync(path, 'utf8')))
    expect(bare).toEqual([])
    const { request } = await import('../src/chat/request')
    providerFetched.length = 0
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')))
    try {
      await request(LOCAL, 'http://x/v1/chat/completions', { body: '{}' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(providerFetched).toEqual(['http://x/v1/chat/completions'])
  })
})
describe('the reader’s standing instructions', () => {
  test('are kept through the keptInstructions door, said under their own line, and nothing once cleared', async () => {
    const { keptInstructions } = await import('../src/api')
    const { instructionsKept, standingInstructions } = await keptInstructions()
    instructionsKept.set('Keep explanations short and concise.')
    expect(standingInstructions()).toBe("The reader's standing instructions:\nKeep explanations short and concise.")
    instructionsKept.set('')
    expect(instructionsKept.text).toBe('')
    expect(standingInstructions()).toBe('')
  })
})
