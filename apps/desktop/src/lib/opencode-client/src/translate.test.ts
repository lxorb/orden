import { describe, expect, test } from 'vitest'
import { asksOf, Feed, verbOf } from './translate'
import type { Event, OcPart } from './types'

const S = 'ses_1'
const tokens = { input: 120, output: 30, reasoning: 0, cache: { read: 40, write: 0 } }
const user = {
  id: 'msg_u',
  sessionID: S,
  role: 'user' as const,
  time: { created: 1 },
  agent: 'build',
  model: { providerID: 'anthropic', modelID: 'claude' },
}
const answer = {
  id: 'msg_a',
  sessionID: S,
  role: 'assistant' as const,
  time: { created: 2 },
  agent: 'build',
  providerID: 'anthropic',
  modelID: 'claude',
  cost: 0.01,
  tokens,
}
const part = (one: Record<string, unknown>): OcPart => ({ sessionID: S, ...one }) as OcPart
const tool = (state: Record<string, unknown>) =>
  part({ id: 'prt_t', messageID: 'msg_a', type: 'tool', callID: 'call_1', tool: 'bash', state })
function fed(events: Event[]) {
  const feed = new Feed()
  feed.load(S, [])
  for (const one of events) feed.apply(one)
  return feed
}
describe('an OpenCode chat read into Orden’s turns (#2470)', () => {
  test('streams the answer’s words in and keeps the question as the reader typed it', () => {
    const feed = fed([
      { type: 'message.updated', properties: { info: user } },
      {
        type: 'message.part.updated',
        properties: { part: part({ id: 'prt_q', messageID: 'msg_u', type: 'text', text: 'How do herons hunt?' }) },
      },
      { type: 'message.updated', properties: { info: answer } },
      {
        type: 'message.part.updated',
        properties: { part: part({ id: 'prt_w', messageID: 'msg_a', type: 'text', text: '' }) },
      },
      {
        type: 'message.part.delta',
        properties: { sessionID: S, messageID: 'msg_a', partID: 'prt_w', field: 'text', delta: 'By standing ' },
      },
      {
        type: 'message.part.delta',
        properties: { sessionID: S, messageID: 'msg_a', partID: 'prt_w', field: 'text', delta: 'still.' },
      },
    ])
    const [asked, said] = feed.turns(S)
    expect(asked).toMatchObject({ role: 'you', draft: { text: 'How do herons hunt?' }, parts: [] })
    expect(said).toMatchObject({
      role: 'model',
      provider: 'anthropic',
      model: 'claude',
      parts: [{ kind: 'text', text: 'By standing still.' }],
    })
    expect(said?.usage).toEqual({ input: 120, cached: 40, output: 30, reasoning: 0, window: null, cost: 0.01 })
  })
  test('shows a tool waiting for a permission as asking, in plain words, until the reply closes it', () => {
    const request = {
      id: 'per_1',
      sessionID: S,
      permission: 'bash',
      patterns: ['rm -rf build/cache'],
      metadata: { command: 'rm -rf build/cache' },
      always: ['rm *'],
      tool: { messageID: 'msg_a', callID: 'call_1' },
    }
    const feed = fed([
      { type: 'message.updated', properties: { info: answer } },
      {
        type: 'message.part.updated',
        properties: { part: tool({ status: 'running', input: { command: 'rm -rf build/cache' } }) },
      },
      { type: 'permission.asked', properties: request },
    ])
    expect(feed.turns(S)[0]?.parts[0]).toMatchObject({
      kind: 'tool',
      id: 'call_1',
      verb: 'bash',
      state: 'asking',
      result: { approval: 'per_1', asks: 'Run rm -rf build/cache' },
    })
    feed.apply({ type: 'permission.replied', properties: { sessionID: S, requestID: 'per_1', reply: 'once' } })
    feed.apply({
      type: 'message.part.updated',
      properties: { part: tool({ status: 'completed', input: {}, output: 'removed', title: 'rm', metadata: {} }) },
    })
    expect(feed.turns(S)[0]?.parts[0]).toMatchObject({ state: 'ok', result: { text: 'removed', error: false } })
    expect(feed.waiting(S)).toEqual([])
  })
  test('names Orden’s own tools by Orden’s verbs, and a failed answer ends in its error', () => {
    expect(verbOf('orden_read_note')).toBe('read_note')
    expect(verbOf('bash')).toBe('bash')
    const feed = fed([
      {
        type: 'message.updated',
        properties: { info: { ...answer, error: { name: 'APIError', data: { message: 'Over the limit' } } } },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: part({
            id: 'prt_t2',
            messageID: 'msg_a',
            type: 'tool',
            callID: 'call_2',
            tool: 'orden_edit_note',
            state: { status: 'error', input: {}, error: 'no such note' },
          }),
        },
      },
    ])
    expect(feed.turns(S)[0]?.parts).toEqual([
      {
        kind: 'tool',
        id: 'call_2',
        verb: 'edit_note',
        args: {},
        state: 'error',
        result: { text: 'no such note', images: [], error: true },
      },
      { kind: 'notice', code: 'error', text: 'Over the limit' },
    ])
  })
  test('says each kind of permission in plain words', () => {
    const ask = (permission: string, patterns: string[], metadata: Record<string, unknown> = {}) =>
      asksOf({ id: 'p', sessionID: S, permission, patterns, metadata, always: [] })
    expect(ask('edit', ['notes/a.md'], { filepath: '/space/notes/a.md' })).toBe('Edit /space/notes/a.md')
    expect(ask('webfetch', ['https://example.org'])).toBe('Open https://example.org')
    expect(ask('orden_trash_file', ['*'])).toBe('trash file')
  })
  test('knows which chats are busy from their status', () => {
    const feed = fed([{ type: 'session.status', properties: { sessionID: S, status: { type: 'busy' } } }])
    expect(feed.running(S)).toBe(true)
    feed.apply({ type: 'session.idle', properties: { sessionID: S } })
    expect(feed.running(S)).toBe(false)
  })
})
