import type { Found } from '@orden/scan/search/walk'
import { type Answer, type Ask, isAnswer, type Warm } from './search-protocol'
import type { Warmth } from '@orden/scan/search/warmth'
import type { Query } from '@orden/scan/search/query'

const STALLED = 3000
let worker: Worker | null = null
interface Waiting {
  ask: Ask
  onFound: (found: Found) => void
  done: () => void
  shown: Set<string>
  given: number
}
const waiting = new Map<number, Waiting>()
let asked = 0
let told: ((warmth: Warmth) => void) | null = null
let warmed: string | null = null
let heard = 0
let at: { id: number; relative: string } | null = null
let watching: ReturnType<typeof setInterval> | null = null
export function warmSpace(root: string, heard: (warmth: Warmth) => void): void {
  told = heard
  warmed = root
  open()?.postMessage({ kind: 'warm', root } satisfies Warm)
}
function open(): Worker | null {
  if (worker) return worker
  let made: Worker
  try {
    made = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  made.onmessage = (event: MessageEvent<unknown>) => {
    if (isAnswer(event.data)) answer(event.data)
  }
  made.onerror = () => {
    for (const one of waiting.values()) one.done()
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  worker = made
  return made
}
function answer(message: Answer) {
  heard = Date.now()
  if (message.kind === 'warmth') {
    told?.(message.warmth)
    return
  }
  const one = waiting.get(message.id)
  if (!one) return
  if (message.kind === 'at') {
    at = { id: message.id, relative: message.relative }
    return
  }
  if (message.kind === 'done') {
    if (at?.id === message.id) at = null
    waiting.delete(message.id)
    one.done()
    return
  }
  const hits = message.hits.filter((hit) => !one.shown.has(hit.path)).slice(0, Math.max(0, one.ask.limit - one.given))
  for (const hit of message.hits) one.shown.add(hit.path)
  one.given += hits.length
  one.onFound({ hits, loose: message.loose })
}
function watch() {
  watching ??= setInterval(() => {
    if (!waiting.size) {
      if (watching !== null) clearInterval(watching)
      watching = null
      return
    }
    if (at !== null && Date.now() - heard > STALLED) startOver()
  }, STALLED / 4)
}
function startOver() {
  const stuck = at
  const again = [...waiting.values()]
  waiting.clear()
  at = null
  worker?.terminate()
  worker = null
  const running = open()
  if (!running) {
    for (const one of again) one.done()
    return
  }
  if (warmed !== null) running.postMessage({ kind: 'warm', root: warmed } satisfies Warm)
  heard = Date.now()
  for (const one of again) {
    const skipped = stuck?.id === one.ask.id ? [stuck.relative] : []
    const ask: Ask = {
      ...one.ask,
      id: ++asked,
      excluded: [...one.ask.excluded, ...skipped],
    }
    waiting.set(ask.id, { ...one, ask })
    running.postMessage(ask)
  }
}
export function searchInWorker(
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const id = ++asked
  return new Promise<void>((resolve) => {
    const running = open()
    if (!running) {
      resolve()
      return
    }
    if (!waiting.size) heard = Date.now()
    const ask: Ask = { kind: 'ask', id, root, query, terms, limit, excluded: [...excluded] }
    waiting.set(id, { ask, onFound, done: resolve, shown: new Set(), given: 0 })
    running.postMessage(ask)
    watch()
  })
}
