/** The helpers agents start: another model, on any provider in use, working on one task
 *  and handing its answer back (docs/ai.md, "Helpers").
 *
 *  Emil, 2026-10-12: "claude can create subagents of openai models. e.g. claude opus 5.5
 *  creating an astra subagent in the same way as it would create a subagent of claude."
 *  So nib's tool `run_agent` is shaped like Claude Code's own `Agent` tool and Codex's
 *  `spawn_agent` - a few words of description, the whole task, a model - and whatever
 *  asks it, the helper is a thread of its own on the provider that model is on, with
 *  that provider's account in use: in the thread list, on its parent's `/jobs`, and its
 *  last words the tool's answer.
 *
 *  **Limits**, the ones Claude Code and Codex keep for their own subagents, tighter
 *  because a helper here spends a plan: at most `DEPTH` helpers deep under the thread
 *  the reader started, `PER_ROOT` running under one such thread, and `MINUTES` each.
 *  A helper works in its parent's mode and never more - Plan stays Plan, Approve asks
 *  the reader for the helper's changes too - with its own provider's built-in grant.
 *  Stopping a thread stops every helper under it; each has its own stop as well.
 *
 *  The store holds what is running and what ended this run; the roads that start a turn
 *  and list the models are handed in (`Roads`), so the rules are tested apart from the
 *  panel. */

import { keepThread, newThread } from '../chat/threads'
import { untrusted } from '../chat/transcript'
import type { Effort, Mode, Thread } from '../chat/types'
import { tasks } from '../commands/tasks.svelte'
import type { Ended } from '../commands/types'
import { type Offered, routed } from './route'

/** How deep helpers go under the thread the reader started. */
export const DEPTH = 2
/** How many run at once under one such thread. */
export const PER_ROOT = 4
/** How long one may run. */
export const MINUTES = 15

export type HelperState = 'running' | 'done' | 'failed' | 'stopped'

export interface Helper {
  /** The helper's thread's id. */
  id: string
  /** The thread that started it, where an outside agent did not. */
  parent: string | null
  /** The thread the reader started, at the top of the chain. */
  root: string
  depth: number
  /** Who it runs on: the provider's account, and the model. */
  provider: string
  model: string
  description: string
  state: HelperState
  /** Its last words, once it has ended. */
  answer: string
  /** It read words from outside, so its words may be somebody else's to steer. */
  outside?: boolean
  error?: string
  started: number
}

/** What a helper is asked: by whom, about what, on which model. */
export interface Asked {
  parent: Thread | null
  space: string
  prompt: string
  description: string
  model: string
  effort?: Effort
  /** The mode it works in: its parent's, or what an outside agent's grant allows. */
  mode: Mode
  /** A profile's instructions (`subagent_type`, a note with `agent:` front matter). */
  instructions?: string
}

/** The roads a helper is started down: the models each provider in use offers, and a
 *  turn in a thread of its own. */
export interface Roads {
  offered(): Promise<Offered[]>
  /** Puts the thread in the list and runs the task in it. */
  run(thread: Thread, text: string, signal: AbortSignal): Promise<Ended>
}

/** The words of a send's last model turn. */
function wordsOf(ended: Ended): string {
  return (
    ended.turn?.parts
      .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
      .join('')
      .trim() ?? ''
  )
}

/** A helper's words as the model that asked for them gets them: inside the untrusted
 *  mark where the helper read words from outside (docs/agent-native.md 9.6). */
export function answerFor(helper: Pick<Helper, 'answer' | 'description' | 'outside'>): string {
  if (!helper.outside || !helper.answer) return helper.answer
  return untrusted(`helper ${helper.description}`, helper.answer)
}

/** What a thread keeps of the work started under it, written down with it: every thread
 *  started under it at any depth, what its review covers (review/changes.ts). */
type Helped = Thread & { helpers?: string[] }

class Helpers {
  /** Every helper of this run, newest last. */
  all = $state.raw<Helper[]>([])

  private stops = new Map<string, AbortController>()
  /** The work running under a thread, by its helper thread's id: only while the turn
   *  or task that started it runs. A thread whose work ended (a `/fork` copy, a finished
   *  `/subtask` the reader carries on) is a thread of its own again. */
  private under = new Map<string, { parent: Helped; child: Thread }>()
  private ends = new Map<string, Promise<void>>()

  get(id: string): Helper | null {
    return this.all.find((one) => one.id === id) ?? null
  }

  /** How deep a thread is: nought for one the reader started. */
  depthOf(thread: string): number {
    return this.get(thread)?.depth ?? 0
  }

  /** The thread the reader started, above a helper. */
  rootOf(thread: string): string {
    return this.get(thread)?.root ?? thread
  }

  private set(id: string, change: Partial<Helper>) {
    this.all = this.all.map((one) => (one.id === id ? { ...one, ...change } : one))
  }

  /** Starts a helper, or says why not. Answers once it is running. */
  async start(asked: Asked, roads: Roads): Promise<Helper | { refused: string }> {
    const parent = asked.parent
    const depth = parent ? this.depthOf(parent.id) + 1 : 1
    if (depth > DEPTH) {
      return { refused: `a helper ${DEPTH} deep may not start another; do the work yourself` }
    }
    const root = parent ? this.rootOf(parent.id) : null
    // Under one thread the reader started; an outside agent's, all of them together.
    const running = this.all.filter(
      (one) => one.state === 'running' && (root === null ? one.parent === null : one.root === root),
    )
    if (running.length >= PER_ROOT) {
      return {
        refused: `${PER_ROOT} helpers are already running; wait for one with agent_result`,
      }
    }

    const offered = await roads.offered()
    const parentProvider = parent
      ? (offered.find((one) => one.provider.id === parent.provider)?.provider ?? null)
      : null
    const route = routed(asked.model, offered, parentProvider)
    if ('refused' in route) return route

    const thread = newThread(
      asked.space,
      route.provider.id,
      route.model,
      asked.effort ?? 'auto',
      asked.mode,
    )
    const named = [asked.description, asked.prompt.split('\n')[0]?.slice(0, 60)].find(Boolean)
    thread.title = `↳ ${named ?? ''}`
    const helper: Helper = {
      id: thread.id,
      parent: parent?.id ?? null,
      root: root ?? thread.id,
      depth,
      provider: route.provider.id,
      model: route.model,
      description: asked.description,
      state: 'running',
      answer: '',
      started: Date.now(),
    }
    this.all = [...this.all, helper]
    if (parent) this.startedUnder(parent, thread)

    const stopper = new AbortController()
    this.stops.set(helper.id, stopper)
    const late = setTimeout(() => stopper.abort(), MINUTES * 60_000)
    const text = asked.instructions ? `${asked.instructions}\n\n${asked.prompt}` : asked.prompt
    this.ends.set(
      helper.id,
      roads
        .run(thread, text, stopper.signal)
        .then(
          (ended) => {
            const state: HelperState =
              stopper.signal.aborted || ended.stop === 'stopped'
                ? 'stopped'
                : ended.stop === 'error'
                  ? 'failed'
                  : 'done'
            this.set(helper.id, {
              state,
              answer: wordsOf(ended),
              ...(ended.outside ? { outside: true } : {}),
              ...(ended.error ? { error: ended.error } : {}),
            })
          },
          (error: unknown) => {
            this.set(helper.id, {
              state: 'failed',
              error: error instanceof Error ? error.message : String(error),
            })
          },
        )
        .finally(() => {
          clearTimeout(late)
          this.stops.delete(helper.id)
          // A helper's own helpers end with it.
          this.stopUnder(helper.id)
          this.endedUnder(helper.id)
        }),
    )
    return helper
  }

  /** The helper as it stands once it has ended, or after `ms` if it is still running. */
  async wait(id: string, ms: number): Promise<Helper | null> {
    const end = this.ends.get(id)
    if (end) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([end, new Promise((done) => (timer = setTimeout(done, ms)))])
      clearTimeout(timer)
    }
    return this.get(id)
  }

  /** `child` runs work for `parent`, started by `run_agent` or by a command
   *  (`/subtask`, `/fork`, `/batch`, `/deep-research`), until `endedUnder`: one tree for
   *  every kind. Every thread above takes it into its review; one above the parent is
   *  written down now, the parent with the turn or command that started it. */
  startedUnder(parent: Thread, child: Thread): void {
    this.under.set(child.id, { parent, child })
    for (let above: Helped | undefined = parent; above; above = this.under.get(above.id)?.parent) {
      if (above.helpers?.includes(child.id)) continue
      above.helpers = [...(above.helpers ?? []), child.id]
      if (above !== parent) void keepThread(above).catch(() => undefined)
    }
  }

  /** The work `child` ran for its parent is over. What it started in it stays in the
   *  reviews above; what is started there later is its own. */
  endedUnder(child: string): void {
    this.under.delete(child)
  }

  /** A thread deleted: out of the tree, with what ran under it. */
  forget(id: string): void {
    this.under.delete(id)
    for (const [child, one] of [...this.under]) if (one.parent.id === id) this.forget(child)
  }

  /** Stops one helper, and every helper under it. */
  stop(id: string): void {
    this.stops.get(id)?.abort()
    this.stopUnder(id)
  }

  /** Stops everything a thread started, down its tree: its work on the task list
   *  (`/batch`, `/subtask`, `/fork`, a goal, a loop), its helpers, and theirs. What
   *  stopping or deleting a thread does. */
  stopUnder(thread: string): void {
    tasks.stop(thread)
    for (const [child, one] of [...this.under]) if (one.parent.id === thread) this.stop(child)
  }
}

export const helpers = new Helpers()
