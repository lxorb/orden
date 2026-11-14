import { invoke, isDesktop } from '../../platform/src/api'
import type { Thread } from '../../ai-providers/src/api'

interface Asked {
  id: string
  agent: string
  verb: string
  category: string
  site?: string
}

export interface Answers {
  answer(id: string, allow: boolean): Promise<void>
  answered(id: string, signal: AbortSignal): Promise<boolean>
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

export function sayAlways(thread: Thread, verb: string, site?: string): void {
  const key = alwaysKey(verb, site)
  if (!thread.always?.includes(key)) thread.always = [...(thread.always ?? []), key]
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function questionIn(payload: unknown): { kind: string; approval: Record<string, unknown> } {
  const event = record(payload)
  return { kind: String(event.kind), approval: record(event.approval) }
}

async function heard(on: (payload: unknown) => void): Promise<() => void> {
  if (!isDesktop) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<unknown>('orden://agent', ({ payload }) => on(payload))
}

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
