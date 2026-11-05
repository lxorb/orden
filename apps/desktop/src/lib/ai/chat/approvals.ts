/** A question a tool call raised, answered where the call is: in its row in the thread
 *  (docs/ai-sidebar.md 4.4). Approve asks before every change; so does paying, in any
 *  mode. The call waits for the answer and then goes ahead, or is told no - the way
 *  Claude Code's own prompt holds its tool, rather than the outside agents' road of
 *  answering at once and asking again later.
 *
 *  The question is the crate's (src-tauri/src/agents/approvals.rs), so the Activity
 *  panel shows it too and an answer there counts here. What this adds is the waiting,
 *  and the thread's own Always: a tool said Always to is answered yes as soon as it
 *  asks an everyday question, on that site where a page is what it asks about, for the
 *  rest of that thread. Paying, sending, deleting, moving to Recently deleted, a press on
 *  what cannot be read, signing in, publishing, the terminal and a file from outside are
 *  asked every time:
 *  page text can steer a tool the reader trusted for a harmless press into any of them,
 *  and the loop would answer for the reader. */

import { invoke, isDesktop } from '../../tauri'
import type { Thread } from './types'

/** A question as the crate tells it: its id, its agent and the verb that asked. */
interface Asked {
  id: string
  agent: string
  verb: string
  category: string
  site?: string
}

/** The crate's questions, as the engines reach them; a fake in the tests. */
export interface Answers {
  /** The reader's answer. */
  answer(id: string, allow: boolean): Promise<void>
  /** Waits for a question's answer: true when allowed, false when refused, expired, or
   *  the turn was stopped. */
  answered(id: string, signal: AbortSignal): Promise<boolean>
  /** Hears every question raised from now on, until the answer is called. */
  asked(on: (asked: Asked) => void): Promise<() => void>
}

const EVERYDAY = new Set(['writing', 'settings', 'showing'])

export function alwaysOffered(category: string | undefined): boolean {
  return category !== undefined && EVERYDAY.has(category)
}

function alwaysKey(verb: string, site: string | undefined): string {
  return site ? `${verb}@${site}` : verb
}

export function always(
  thread: Thread,
  verb: string,
  category: string | undefined,
  site?: string,
): boolean {
  return alwaysOffered(category) && (thread.always?.includes(alwaysKey(verb, site)) ?? false)
}

/** Always, for the rest of the thread. */
export function sayAlways(thread: Thread, verb: string, site?: string): void {
  const key = alwaysKey(verb, site)
  if (!thread.always?.includes(key)) thread.always = [...(thread.always ?? []), key]
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** One of the crate's events, as far as a question goes: which kind, and the question. */
function questionIn(payload: unknown): { kind: string; approval: Record<string, unknown> } {
  const event = record(payload)
  return { kind: String(event.kind), approval: record(event.approval) }
}

async function heard(on: (payload: unknown) => void): Promise<() => void> {
  if (!isDesktop) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<unknown>('nib://agent', ({ payload }) => on(payload))
}

/** The crate. */
export const crateAnswers: Answers = {
  async answer(id, allow) {
    await invoke('agents_answer', { id, allow, always: false }).catch(() => undefined)
  },

  answered(id, signal) {
    return new Promise((resolve) => {
      let done = false
      let stop: (() => void) | null = null
      const end = (allowed: boolean) => {
        if (done) return
        done = true
        stop?.()
        signal.removeEventListener('abort', aborted)
        resolve(allowed)
      }
      const aborted = () => end(false)
      signal.addEventListener('abort', aborted)
      void heard((payload) => {
        const { kind, approval } = questionIn(payload)
        if (kind !== 'answered' || approval.id !== id) return
        end(approval.answer === 'allowed' || approval.answer === 'done')
      }).then((unlisten) => {
        if (done) unlisten()
        else stop = unlisten
      })
      if (signal.aborted) end(false)
    })
  },

  asked(on) {
    return heard((payload) => {
      const { kind, approval } = questionIn(payload)
      if (kind !== 'asked' || typeof approval.id !== 'string') return
      const words = (value: unknown) => (typeof value === 'string' ? value : '')
      on({
        id: approval.id,
        agent: words(approval.agent),
        verb: words(approval.verb),
        category: words(approval.category),
        ...(words(approval.site) ? { site: words(approval.site) } : {}),
      })
    })
  },
}
