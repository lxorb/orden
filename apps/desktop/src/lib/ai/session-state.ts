/** Where every chat stands, as one of seven states, and the one machine that moves it
 *  (#1089).
 *
 *  A chat is always exactly one of these, so somebody running several agents at once can
 *  read the list instead of opening each to look. The runtime moves it, never the
 *  reader's eyes: a send starts it, a question for the reader stops it on them, how the
 *  answer ended settles it, work left running out of sight (a goal, a loop, a helper, a
 *  wait for the plan to reset) keeps it waiting. Every one of those paths goes through
 *  `next` here, by way of `Chat.move` (sidebar/chat.svelte.ts), which is the one door.
 *
 *  Unread is not a state: it is whether the reader has seen what came (#1064), beside
 *  the state, so a chat can be done and unread or done and read. A helper has a state of
 *  its own but no row (#1062): its chat carries it, and a question a helper asks is the
 *  chat's question (`statesOf`). */

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

/** What happens to a chat. */
export type SessionEvent =
  /** A send, a retry, a compaction: the agent is at work. */
  | { type: 'start' }
  /** The agent asked the reader something: a question, an approval. */
  | { type: 'ask' }
  /** The reader answered it, and the agent goes on. */
  | { type: 'answered' }
  /** The turn ended, how it ended; `busy` where work it started goes on out of sight. */
  | { type: 'end'; stop: Stop; busy: boolean }
  /** Work out of sight started with no turn running, or a wait for the plan to reset. */
  | { type: 'wait' }
  /** The last of that work ended by itself. */
  | { type: 'idle' }
  /** The app was opened again: nothing that was at work is any more. */
  | { type: 'relaunch' }
  | { type: 'archive' }
  | { type: 'unarchive' }

/** What a chat that never said is: one written before there were states, or one with
 *  nothing sent yet. */
export const FIRST_STATE: SessionState = 'done'

/** How a turn's end settles a chat: an answer that ran to its end is done, one stopped
 *  short (the reader's stop, the step limit, the token limit) interrupted, a failure or
 *  a refusal an error. */
function ended(stop: Stop, busy: boolean): SessionState {
  if (stop === 'end') return busy ? 'waiting' : 'done'
  if (stop === 'error' || stop === 'refusal') return 'error'
  return 'interrupted'
}

/** The state a chat moves to. Anything an event does not apply to stays as it is: a
 *  question cannot be answered that was not asked, and background work starting does
 *  not take a chat off a question it is waiting on. */
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

/** Which state a list puts first: what wants the reader, then what is still going. A
 *  question before a failure before a stop before a finished answer, and the chats
 *  still at work last, since there is nothing to do about them yet. */
const PRIORITY: Record<SessionState, number> = {
  'needs-input': 0,
  error: 1,
  interrupted: 2,
  done: 3,
  waiting: 4,
  running: 5,
  archived: 6,
}

/** The colour each state is drawn in, by accent (accents.ts): every state also has its
 *  own mark (StateMark.svelte), so none is told by colour alone. */
export const STATE_COLOURS: Record<SessionState, string> = {
  running: 'slate',
  waiting: 'blue',
  error: 'red',
  'needs-input': 'orange',
  done: 'green',
  interrupted: 'yellow',
  archived: 'slate',
}

/** Each chat's state as a list shows it: its own, unless a helper under it is waiting on
 *  the reader, which is then the chat's question (#1062). */
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

/** A head's own state: archived where it is, else what it last said. */
export function stateOf(head: Pick<ThreadHead, 'state' | 'archived'>): SessionState {
  return head.archived ? 'archived' : (head.state ?? FIRST_STATE)
}

/** The chats in the order every list of them shows (#1089): pinned ones first, then by
 *  state, unread before read within a state, then the latest first. Archived ones are
 *  left out; a list that offers them asks for them on their own. */
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

/** The chat beside `id` in `list`, the way a swipe goes (`step` 1 the next, -1 the one
 *  before), round from the last to the first: sliding on and on goes through all of
 *  them. Null where there is no other. */
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

/** What each state is called, marked for translation and translated where it is shown:
 *  the mark's tooltip and the row's name for a screen reader. */
export const STATE_WORDS: Record<SessionState, string> = {
  running: key('Working'),
  waiting: key('Waiting'),
  error: key('Failed'),
  'needs-input': key('Needs input'),
  done: key('Done'),
  interrupted: key('Interrupted'),
  archived: key('Archived'),
}

/** Each state's own mark on the 13 unit grid the panel's glyphs are drawn on, so a
 *  state reads without its colour: a turning arc, a clock, a bang, a question, a tick, a
 *  pause, a box. */
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
