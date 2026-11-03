import { describe, expect, test } from 'vitest'
import type { ThreadHead } from './chat/types'
import {
  beside,
  next,
  ordered,
  SESSION_STATES,
  type SessionState,
  STATE_COLOURS,
  STATE_MARKS,
  stateOf,
  statesOf,
} from './session-state'

/** #1089: every chat is always exactly one state, moved by one machine. */
describe('the state a chat moves to', () => {
  test('a send starts it, from wherever it was', () => {
    for (const state of SESSION_STATES) expect(next(state, { type: 'start' })).toBe('running')
  })

  test('a question stops it on the reader, and the answer sets it going again', () => {
    expect(next('running', { type: 'ask' })).toBe('needs-input')
    expect(next('needs-input', { type: 'answered' })).toBe('running')
    // Nothing was asked of a chat that is done, so nothing is answered.
    expect(next('done', { type: 'ask' })).toBe('done')
    expect(next('running', { type: 'answered' })).toBe('running')
  })

  test('how the answer ended settles it', () => {
    const end = (stop: Parameters<typeof next>[1] & { type: 'end' }) => next('running', stop)
    expect(end({ type: 'end', stop: 'end', busy: false })).toBe('done')
    expect(end({ type: 'end', stop: 'stopped', busy: false })).toBe('interrupted')
    expect(end({ type: 'end', stop: 'steps', busy: false })).toBe('interrupted')
    expect(end({ type: 'end', stop: 'max_tokens', busy: false })).toBe('interrupted')
    expect(end({ type: 'end', stop: 'error', busy: false })).toBe('error')
    expect(end({ type: 'end', stop: 'refusal', busy: false })).toBe('error')
  })

  /** Waiting is on something outside the reader: work it left running, a timer. */
  test('work left running out of sight keeps it waiting, until the last of it ends', () => {
    expect(next('running', { type: 'end', stop: 'end', busy: true })).toBe('waiting')
    expect(next('done', { type: 'wait' })).toBe('waiting')
    expect(next('waiting', { type: 'idle' })).toBe('done')
    // Not over a question, and not while it is at work itself.
    expect(next('needs-input', { type: 'wait' })).toBe('needs-input')
    expect(next('running', { type: 'wait' })).toBe('running')
  })

  test('a relaunch interrupts whatever was at work, and nothing else', () => {
    expect(next('running', { type: 'relaunch' })).toBe('interrupted')
    expect(next('waiting', { type: 'relaunch' })).toBe('interrupted')
    expect(next('needs-input', { type: 'relaunch' })).toBe('interrupted')
    expect(next('done', { type: 'relaunch' })).toBe('done')
    expect(next('error', { type: 'relaunch' })).toBe('error')
  })

  test('archived until it is brought back, which finds it done', () => {
    expect(next('error', { type: 'archive' })).toBe('archived')
    expect(next('archived', { type: 'end', stop: 'end', busy: false })).toBe('archived')
    expect(next('archived', { type: 'unarchive' })).toBe('done')
  })

  /** Never told by colour alone: each has its own mark too. */
  test('each state has its own mark and a colour', () => {
    expect(new Set(SESSION_STATES.map((one) => STATE_MARKS[one])).size).toBe(SESSION_STATES.length)
    for (const one of SESSION_STATES) expect(STATE_COLOURS[one], one).toBeTruthy()
  })
})

const head = (id: string, more: Partial<ThreadHead> = {}): ThreadHead => ({
  id,
  title: id,
  provider: 'p',
  model: 'm',
  updated: 0,
  words: '',
  ...more,
})

describe('the order chats are listed in', () => {
  const states = (heads: ThreadHead[]) => statesOf(heads)

  test('puts what wants the reader first, and what is still at work last', () => {
    const heads = [
      head('running', { state: 'running', updated: 9 }),
      head('done', { state: 'done', updated: 8 }),
      head('asks', { state: 'needs-input', updated: 1 }),
      head('failed', { state: 'error', updated: 2 }),
      head('waits', { state: 'waiting', updated: 7 }),
      head('stopped', { state: 'interrupted', updated: 3 }),
    ]
    expect(ordered(heads, states(heads), new Set()).map((one) => one.id)).toEqual([
      'asks',
      'failed',
      'stopped',
      'done',
      'waits',
      'running',
    ])
  })

  test('unread before read within a state, then the latest first', () => {
    const heads = [
      head('old', { state: 'done', updated: 1 }),
      head('new', { state: 'done', updated: 5 }),
      head('unread', { state: 'done', updated: 2 }),
    ]
    expect(ordered(heads, states(heads), new Set(['unread'])).map((one) => one.id)).toEqual([
      'unread',
      'new',
      'old',
    ])
  })

  test('pinned at the top, and archived out of the list', () => {
    const heads = [
      head('asks', { state: 'needs-input', updated: 9 }),
      head('pinned', { state: 'done', pinned: 1 }),
      head('gone', { state: 'needs-input', archived: true }),
    ]
    expect(ordered(heads, states(heads), new Set()).map((one) => one.id)).toEqual([
      'pinned',
      'asks',
    ])
  })

  /** A chat written before there were states reads as done. */
  test('one with no state is done', () => {
    expect(stateOf(head('old'))).toBe('done')
    expect(stateOf(head('old', { archived: true }))).toBe('archived')
  })
})

/** #1062, #1089: a helper is no row and has no state of its own in the list; its chat
 *  carries it, and a question the helper asks is the chat's. */
describe('a helper', () => {
  test('waiting on the reader puts its chat on them', () => {
    const heads = [
      head('chat', { state: 'running' }),
      head('helper', { parent: 'chat', state: 'needs-input' }),
      head('deeper', { parent: 'helper', state: 'needs-input' }),
    ]
    const found = statesOf(heads)
    expect(found.get('chat')).toBe<SessionState>('needs-input')
  })

  test('and otherwise leaves its chat as it is', () => {
    const heads = [
      head('chat', { state: 'done' }),
      head('helper', { parent: 'chat', state: 'error' }),
    ]
    expect(statesOf(heads).get('chat')).toBe('done')
  })
})

describe('sliding to the chat beside', () => {
  const list = [head('a'), head('b'), head('c')]

  test('goes to the next and the one before, round from the last to the first', () => {
    expect(beside(list, 'a', 1)?.id).toBe('b')
    expect(beside(list, 'a', -1)?.id).toBe('c')
    expect(beside(list, 'c', 1)?.id).toBe('a')
  })

  test('and nowhere with one chat', () => {
    expect(beside([head('a')], 'a', 1)).toBeNull()
  })
})
