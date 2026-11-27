import { describe, expect, test, vi } from 'vitest'
import type { EngineEvent, Thread } from '../../../ai-providers/src/api'
import type { Event } from '../../../opencode-client/src/api'
import { createOpenCodeEngine, modelOf, presetOf, type Wiring } from './engine'

vi.stubGlobal('localStorage', new Map() as unknown)
const S = 'ses_1'
const tokens = { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }
const answer = {
  id: 'msg_a',
  sessionID: S,
  role: 'assistant',
  time: { created: 2 },
  agent: 'build',
  providerID: 'anthropic',
  modelID: 'claude',
  cost: 0,
  tokens,
}
const text = (said: string): Event => ({
  type: 'message.part.updated',
  properties: { part: { id: 'prt_w', sessionID: S, messageID: 'msg_a', type: 'text', text: said } },
})
const busy: Event = { type: 'session.status', properties: { sessionID: S, status: { type: 'busy' } } }
const idle: Event = { type: 'session.idle', properties: { sessionID: S } }
function thread(more: Partial<Thread> = {}): Thread {
  return {
    id: `t-${String(Math.random())}`,
    space: 'work',
    title: '',
    provider: 'p',
    model: 'anthropic/claude',
    effort: 'auto',
    mode: 'approve',
    turns: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
    created: 1,
    updated: 1,
    ...more,
  }
}
function wired(script: (hear: (event: Event) => void) => void | Promise<void>) {
  let hear: (event: Event) => void = () => undefined
  const calls: unknown[][] = []
  const wiring: Wiring = {
    session: (title) => (calls.push(['session', title]), Promise.resolve({ id: S })),
    messages: () => Promise.resolve([]),
    permissions: () => Promise.resolve([]),
    prompt: async (...args) => {
      calls.push(['prompt', ...args])
      await Promise.resolve()
      void script(hear)
    },
    abort: (id) => (calls.push(['abort', id]), Promise.resolve(true)),
    summarize: () => Promise.resolve(true),
    providers: () =>
      Promise.resolve({
        all: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: { claude: { id: 'claude', name: 'Claude', limit: { context: 200000, output: 8000 } } },
          },
          {
            id: 'openai',
            name: 'OpenAI',
            models: { gpt: { id: 'gpt', name: 'GPT', limit: { context: 128000, output: 8000 } } },
          },
        ],
        connected: ['anthropic'],
        default: {},
      }),
    ready: (preset) => (calls.push(['ready', preset]), Promise.resolve()),
    follow: (on) => {
      hear = on
      return Promise.resolve(() => undefined)
    },
  }
  const engine = createOpenCodeEngine(
    { provider: () => null, instructions: () => Promise.resolve('Be brief.') },
    wiring,
    () => 'plan',
  )
  return { engine, calls }
}
async function sent(engine: ReturnType<typeof wired>['engine'], one: Thread, signal = new AbortController().signal) {
  const events: EngineEvent[] = []
  await engine.send(one, { text: 'How do herons hunt?', attachments: [] }, (event) => events.push(event), signal)
  return events
}
describe('the OpenCode engine (#2470)', () => {
  test('asks OpenCode with the preset, agent, model and instructions, and streams the answer into a model turn', async () => {
    const { engine, calls } = wired((hear) => {
      hear(busy)
      hear({ type: 'message.updated', properties: { info: answer } } as Event)
      hear(text('By standing'))
      hear(text('By standing still.'))
      hear(idle)
    })
    const one = thread({ mode: 'full' })
    const events = await sent(engine, one)
    expect(calls).toContainEqual(['ready', 'full'])
    expect(calls).toContainEqual([
      'prompt',
      S,
      'How do herons hunt?',
      { agent: 'plan', system: 'Be brief.', providerID: 'anthropic', modelID: 'claude' },
    ])
    expect(one.turns.map((turn) => turn.role)).toEqual(['you', 'model'])
    expect(one.turns[1]?.parts).toEqual([{ kind: 'text', text: 'By standing still.' }])
    expect(one.title).toBe('How do herons hunt?')
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'end' })
  })
  test('shows a permission OpenCode asks as an asking tool with its id', async () => {
    let seen: Thread['turns'] = []
    const { engine } = wired((hear) => {
      hear(busy)
      hear({ type: 'message.updated', properties: { info: answer } } as Event)
      hear({
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'prt_t',
            sessionID: S,
            messageID: 'msg_a',
            type: 'tool',
            callID: 'call_1',
            tool: 'bash',
            state: { status: 'running', input: { command: 'ls' } },
          },
        },
      })
      hear({
        type: 'permission.asked',
        properties: {
          id: 'per_1',
          sessionID: S,
          permission: 'bash',
          patterns: ['ls'],
          metadata: { command: 'ls' },
          always: [],
          tool: { messageID: 'msg_a', callID: 'call_1' },
        },
      })
      seen = structuredClone(one.turns)
      hear(idle)
    })
    const one = thread()
    await sent(engine, one)
    expect(seen[1]?.parts[0]).toMatchObject({
      kind: 'tool',
      verb: 'bash',
      state: 'asking',
      result: { approval: 'per_1', asks: 'Run ls' },
    })
  })
  test('ends in OpenCode’s error, and stops through abort', async () => {
    const failing = wired((hear) => {
      hear({
        type: 'session.error',
        properties: { sessionID: S, error: { name: 'APIError', data: { message: 'Over the limit' } } },
      })
    })
    const events = await sent(failing.engine, thread())
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'error', error: 'Over the limit' })
    const halt = new AbortController()
    const stopping = wired((hear) => {
      hear(busy)
      halt.abort()
      hear(idle)
    })
    const stopped = await sent(stopping.engine, thread(), halt.signal)
    expect(stopping.calls).toContainEqual(['abort', S])
    expect(stopped.at(-1)).toEqual({ type: 'done', stop: 'stopped' })
  })
  test('keeps one session per chat', async () => {
    const { engine, calls } = wired((hear) => {
      hear(busy)
      hear(idle)
    })
    const one = thread()
    await sent(engine, one)
    await sent(engine, one)
    expect(calls.filter((call) => call[0] === 'session')).toHaveLength(1)
  })
  test('offers the models of the connected providers only, named by provider and model', async () => {
    const { engine } = wired(() => undefined)
    const models = await engine.models({ id: 'p', kind: 'anthropic', name: 'P', model: 'm' })
    expect(models.map((one) => [one.id, one.window])).toEqual([['anthropic/claude', 200000]])
  })
  test('reads the preset from the chat’s mode and the model as provider/model', () => {
    expect([presetOf('approve'), presetOf('auto'), presetOf('full'), presetOf('plan')]).toEqual([
      'approve',
      'auto',
      'full',
      'approve',
    ])
    expect(modelOf('anthropic/claude-sonnet')).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet' })
    expect(modelOf('gpt')).toEqual({})
  })
})
