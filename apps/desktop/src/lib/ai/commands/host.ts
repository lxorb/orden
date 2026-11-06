import { t } from '../../i18n.svelte'
import { complete } from '../complete'
import type { Message, Provider } from '../providers'
import { ai } from '../store.svelte'
import { engineFor, type Setup } from '../chat/engine'
import { keepThread } from '../chat/threads'
import type { Draft, EngineEvent, NoticeCode, Thread, Turn, Usage } from '../chat/types'
import { added } from '../chat/usage'
import { instructionsFor } from './instructions'
import type { Ended, Once, Panel } from './types'

export interface Host {
  panel: Panel
  provider(thread: Thread): Provider | null
  turn(thread: Thread, text: string, once?: Once): Promise<Ended>
  adopt(thread: Thread, open?: boolean): void
  touched(thread: Thread): void
  line(thread: Thread, text: string, code?: NoticeCode, threads?: readonly string[]): void
  ask(thread: Thread, messages: readonly Message[], signal?: AbortSignal): Promise<string>
}

const providerOf = (id: string): Provider | null => ai.provider(id)

const setup: Setup = { provider: providerOf, instructions: instructionsFor }

function ending(): { on: (event: EngineEvent) => void; ended: () => Ended } {
  let stop: Ended['stop'] = 'end'
  let error: string | undefined
  let turn: Turn | null = null
  let usage: Usage | null = null
  let limit: Ended['limit']
  return {
    on(event) {
      if (event.type === 'turn' && event.turn.role === 'model') turn = event.turn
      else if (event.type === 'usage') usage = usage ? added(usage, event.usage) : event.usage
      else if (event.type === 'limit') limit = event.limit
      else if (event.type === 'done') {
        stop = event.stop
        error = event.error
      }
    },
    ended: () => ({
      stop,
      turn,
      usage,
      ...(error !== undefined ? { error } : {}),
      ...(limit ? { limit } : {}),
    }),
  }
}

async function directTurn(thread: Thread, text: string, once: Once = {}): Promise<Ended> {
  const provider = providerOf(thread.provider)
  if (!provider)
    return {
      stop: 'error',
      error: t('Add an AI provider in Settings first.'),
      turn: null,
      usage: null,
    }
  const engine = await engineFor(provider.kind, setup)
  const before = { mode: thread.mode, model: thread.model, effort: thread.effort }
  Object.assign(thread, {
    ...(once.mode ? { mode: once.mode } : {}),
    ...(once.model ? { model: once.model } : {}),
    ...(once.effort ? { effort: once.effort } : {}),
  })
  const heard = ending()
  const draft: Draft = { text, attachments: [] }
  try {
    await engine.send(thread, draft, heard.on, once.signal ?? new AbortController().signal)
  } finally {
    Object.assign(thread, before)
    await keepThread(thread).catch(() => undefined)
  }
  return heard.ended()
}

export function hostOf(panel: Panel): Host {
  const touched = (thread: Thread) => {
    if (panel.touched) panel.touched(thread)
    else void keepThread(thread).catch(() => undefined)
  }
  return {
    panel,
    provider: (thread) => providerOf(thread.provider),
    turn: (thread, text, once) =>
      panel.turn ? panel.turn(thread, text, once) : directTurn(thread, text, once),
    adopt(thread, open = false) {
      if (panel.adopt) panel.adopt(thread, open)
      else void keepThread(thread).catch(() => undefined)
    },
    touched,
    line(thread, text, code = 'command', threads = []) {
      thread.turns.push({
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [
          { kind: 'notice', code, text, ...(threads.length ? { threads: [...threads] } : {}) },
        ],
      })
      thread.updated = Date.now()
      if (panel.answered) panel.answered(thread)
      else thread.answered = thread.updated
      touched(thread)
    },
    async ask(thread, messages, signal) {
      const provider = providerOf(thread.provider)
      if (!provider) throw new Error(t('Add an AI provider in Settings first.'))
      return await complete({
        provider,
        model: thread.model,
        messages,
        ...(signal ? { signal } : {}),
      })
    },
  }
}

export function sendHere(host: Host, thread: Thread | null, text: string, once?: Once): void {
  const { panel } = host
  if (!once) {
    panel.send(text)
    return
  }
  const open = thread ?? panel.ensure?.() ?? null
  if (open && panel.turn) {
    void panel.turn(open, text, once)
    return
  }
  if (once.mode) panel.setMode(once.mode)
  panel.send(text)
}

export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}
