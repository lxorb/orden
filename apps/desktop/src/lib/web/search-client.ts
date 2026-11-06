import type { Found } from '@orden/scan/search/walk'
import { type Answer, type Ask, isAnswer, type Warm } from './search-protocol'
import type { Warmth } from '../search/warmth'
import type { Query } from '@orden/scan/search/query'

let worker: Worker | null = null

const waiting = new Map<number, { onFound: (found: Found) => void; done: () => void }>()

let asked = 0

let told: ((warmth: Warmth) => void) | null = null

export function whenWarmer(heard: (warmth: Warmth) => void): void {
  told = heard
}

export function warmSpace(root: string): void {
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
  if (message.kind === 'warmth') {
    told?.(message.warmth)
    return
  }

  const one = waiting.get(message.id)
  if (!one) return

  if (message.kind === 'done') {
    waiting.delete(message.id)
    one.done()
    return
  }

  one.onFound({ hits: message.hits, loose: message.loose })
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
    waiting.set(id, { onFound, done: resolve })
    running.postMessage({
      kind: 'ask',
      id,
      root,
      query,
      terms,
      limit,
      excluded: [...excluded],
    } satisfies Ask)
  })
}
