import { key } from '../i18n.svelte'
import type { Stop, ThreadHead } from './chat/types'

export type SessionState =
  'running' | 'waiting' | 'error' | 'needs-input' | 'done' | 'interrupted' | 'archived'

export const SESSION_STATES: readonly SessionState[] = [
  'running',
  'waiting',
  'error',
  'needs-input',
  'done',
  'interrupted',
  'archived',
]

export function isSessionState(value: unknown): value is SessionState {
  return typeof value === 'string' && (SESSION_STATES as readonly string[]).includes(value)
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'ask' }
  | { type: 'answered' }
  | { type: 'end'; stop: Stop; busy: boolean }
  | { type: 'wait' }
  | { type: 'idle' }
  | { type: 'relaunch' }
  | { type: 'archive' }
  | { type: 'unarchive' }

export const FIRST_STATE: SessionState = 'done'

function ended(stop: Stop, busy: boolean): SessionState {
  if (stop === 'end') return busy ? 'waiting' : 'done'
  if (stop === 'error' || stop === 'refusal') return 'error'
  return 'interrupted'
}

export function next(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'start':
      return 'running'
    case 'ask':
      return state === 'running' || state === 'waiting' ? 'needs-input' : state
    case 'answered':
      return state === 'needs-input' ? 'running' : state
    case 'end':
      return state === 'archived' ? state : ended(event.stop, event.busy)
    case 'wait':
      return state === 'done' || state === 'error' || state === 'interrupted' ? 'waiting' : state
    case 'idle':
      return state === 'waiting' ? 'done' : state
    case 'relaunch':
      return state === 'running' || state === 'waiting' || state === 'needs-input'
        ? 'interrupted'
        : state
    case 'archive':
      return 'archived'
    case 'unarchive':
      return state === 'archived' ? 'done' : state
  }
}

const PRIORITY: Record<SessionState, number> = {
  'needs-input': 0,
  error: 1,
  interrupted: 2,
  done: 3,
  waiting: 4,
  running: 5,
  archived: 6,
}

export const STATE_COLOURS: Record<SessionState, string> = {
  running: 'slate',
  waiting: 'blue',
  error: 'red',
  'needs-input': 'orange',
  done: 'green',
  interrupted: 'yellow',
  archived: 'slate',
}

export function statesOf(heads: readonly ThreadHead[]): Map<string, SessionState> {
  const byId = new Map(heads.map((one) => [one.id, one]))
  const topOf = (head: ThreadHead): ThreadHead => {
    let at = head
    for (const passed = new Set<string>(); at.parent && !passed.has(at.id);) {
      passed.add(at.id)
      const above = byId.get(at.parent)
      if (!above) break
      at = above
    }
    return at
  }
  const states = new Map<string, SessionState>()
  for (const head of heads) states.set(head.id, stateOf(head))
  for (const head of heads) {
    if (!head.parent || stateOf(head) !== 'needs-input') continue
    const top = topOf(head)
    if (top.id !== head.id && states.get(top.id) !== 'archived') states.set(top.id, 'needs-input')
  }
  return states
}

export function stateOf(head: Pick<ThreadHead, 'state' | 'archived'>): SessionState {
  return head.archived ? 'archived' : (head.state ?? FIRST_STATE)
}

export function ordered<T extends ThreadHead>(
  heads: readonly T[],
  states: ReadonlyMap<string, SessionState>,
  unread: ReadonlySet<string>,
): T[] {
  const state = (one: T) => states.get(one.id) ?? stateOf(one)
  return heads
    .filter((one) => state(one) !== 'archived')
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        PRIORITY[state(a)] - PRIORITY[state(b)] ||
        Number(unread.has(b.id)) - Number(unread.has(a.id)) ||
        b.updated - a.updated,
    )
}

export function beside<T extends { id: string }>(
  list: readonly T[],
  id: string,
  step: 1 | -1,
): T | null {
  if (list.length < 2) return null
  const at = list.findIndex((one) => one.id === id)
  if (at < 0) return list[step === 1 ? 0 : list.length - 1] ?? null
  return list[(at + step + list.length) % list.length] ?? null
}

export const STATE_WORDS: Record<SessionState, string> = {
  running: key('Working'),
  waiting: key('Waiting'),
  error: key('Failed'),
  'needs-input': key('Needs input'),
  done: key('Done'),
  interrupted: key('Interrupted'),
  archived: key('Archived'),
}

export const STATE_MARKS: Record<SessionState, string> = {
  running: 'M6.5 1.8a4.7 4.7 0 1 1-4.7 4.7',
  waiting: 'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM6.5 3.9v2.6l1.7 1.1',
  error: 'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM6.5 4v3M6.5 9h.01',
  'needs-input':
    'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM5.1 5.2a1.5 1.5 0 1 1 2.1 1.4c-.5.2-.7.6-.7 1.1M6.5 9.3h.01',
  done: 'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM4.4 6.6l1.4 1.4 2.8-2.9',
  interrupted: 'M6.5 1.8a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 1 0 0-9.4zM5.4 4.8v3.4M7.6 4.8v3.4',
  archived: 'M2 3h9v2.2H2zM2.8 5.2v4.8h7.4V5.2M5.3 7h2.4',
}
