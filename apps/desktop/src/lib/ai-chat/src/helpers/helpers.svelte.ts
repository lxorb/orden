import { keepThread, newThread } from '../chat/threads'
import { untrusted } from '../chat/transcript'
import type { Effort, Mode, Thread } from '../../../ai-providers/src/api'
import { keptUnder } from '../chat/reach'
import { tasks } from '../commands/tasks.svelte'
import type { Ended } from '../commands/types'
import { type Offered, routed } from './route'

export const DEPTH = 2
export const PER_ROOT = 4
export const MINUTES = 15
type HelperState = 'running' | 'done' | 'failed' | 'stopped'
export interface Helper {
  id: string
  parent: string | null
  root: string
  depth: number
  provider: string
  model: string
  description: string
  state: HelperState
  answer: string
  outside?: boolean
  error?: string
  started: number
}
interface Asked {
  parent: Thread | null
  asking?: string
  space: string
  prompt: string
  description: string
  model: string
  effort?: Effort
  mode: Mode
  without?: readonly string[]
  only?: readonly string[]
  instructions?: string
}
interface Roads {
  offered(): Promise<Offered[]>
  run(thread: Thread, text: string, signal: AbortSignal): Promise<Ended>
}
function wordsOf(ended: Ended): string {
  return (
    ended.turn?.parts
      .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
      .join('')
      .trim() ?? ''
  )
}
export function answerFor(helper: Pick<Helper, 'answer' | 'description' | 'outside'>): string {
  if (!helper.outside || !helper.answer) return helper.answer
  return untrusted(`helper ${helper.description}`, helper.answer)
}
type Helped = Thread & { helpers?: string[] }
class Helpers {
  all = $state.raw<Helper[]>([])
  private stops = new Map<string, AbortController>()
  private under = new Map<string, { parent: string; above: Helped | null; child: Thread }>()
  private ends = new Map<string, Promise<void>>()
  released: (thread: Thread) => void = () => undefined
  get(id: string): Helper | null {
    return this.all.find((one) => one.id === id) ?? null
  }
  depthOf(thread: string): number {
    return this.get(thread)?.depth ?? 0
  }
  rootOf(thread: string): string {
    return this.get(thread)?.root ?? thread
  }
  private set(id: string, change: Partial<Helper>) {
    this.all = this.all.map((one) => (one.id === id ? { ...one, ...change } : one))
  }
  async start(asked: Asked, roads: Roads): Promise<Helper | { refused: string }> {
    const parent = asked.parent
    const from = parent?.id ?? asked.asking ?? null
    const depth = from ? this.depthOf(from) + 1 : 1
    if (depth > DEPTH) {
      return { refused: `a helper ${DEPTH} deep may not start another; do the work yourself` }
    }
    const root = from ? this.rootOf(from) : null
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
    const thread = newThread(asked.space, route.provider.id, route.model, asked.effort ?? 'auto', asked.mode)
    keptUnder(
      {
        mode: asked.mode,
        ...(asked.without ? { without: [...asked.without] } : {}),
        ...(asked.only ? { only: [...asked.only] } : {}),
      },
      thread,
    )
    const named = [asked.description, asked.prompt.split('\n')[0]?.slice(0, 60)].find(Boolean)
    thread.title = `↳ ${named ?? ''}`
    if (from) thread.parent = from
    const helper: Helper = {
      id: thread.id,
      parent: from,
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
    else if (from) this.under.set(thread.id, { parent: from, above: null, child: thread })
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
          this.stopUnder(helper.id)
          this.endedUnder(thread)
        }),
    )
    return helper
  }
  async wait(id: string, ms: number, until?: AbortSignal): Promise<Helper | null> {
    const end = this.ends.get(id)
    if (end && !until?.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      let stop: () => void = () => undefined
      const waiting = new Promise<void>((done) => {
        stop = done
        timer = setTimeout(done, ms)
        until?.addEventListener('abort', stop, { once: true })
      })
      await Promise.race([end, waiting])
      clearTimeout(timer)
      until?.removeEventListener('abort', stop)
    }
    return this.get(id)
  }
  startedUnder(parent: Thread, child: Thread): void {
    keptUnder(parent, child)
    this.under.set(child.id, { parent: parent.id, above: parent, child })
    for (let above: Helped | null | undefined = parent; above; above = this.under.get(above.id)?.above) {
      if (above.helpers?.includes(child.id)) continue
      above.helpers = [...(above.helpers ?? []), child.id]
      void keepThread(above).catch(() => undefined)
    }
  }
  endedUnder(child: Thread): void {
    this.under.delete(child.id)
    this.released(child)
  }
  forget(id: string): void {
    this.under.delete(id)
    for (const [child, one] of [...this.under]) if (one.parent === id) this.forget(child)
  }
  stop(id: string): void {
    this.stops.get(id)?.abort()
    this.stopUnder(id)
  }
  stopUnder(thread: string): void {
    tasks.stop(thread)
    for (const [child, one] of [...this.under]) if (one.parent === thread) this.stop(child)
  }
}
export const helpers = new Helpers()
