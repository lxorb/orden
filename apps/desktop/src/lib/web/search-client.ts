/** The page's side of the search worker.
 *
 *  One worker, kept: starting one costs a module graph being compiled, and a
 *  reader typing a word would otherwise pay for it per keystroke. A search
 *  already running is not stopped when the next one is asked - it is answering
 *  about a word nobody is looking for any more, and its answers are dropped by
 *  their id - because there is nothing to gain by tearing the walk down that
 *  finishing it does not give sooner. */

import type { Found } from './search'
import { type Answer, isAnswer } from './search-protocol'
import type { Query } from '../search/query'

let worker: Worker | null = null

/** Which search each waiting caller is, so an answer reaches the one that asked
 *  for it and nothing else. */
const waiting = new Map<number, { onFound: (found: Found) => void; done: () => void }>()

let asked = 0

function open(): Worker {
  if (worker) return worker

  const made = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' })
  made.onmessage = (event: MessageEvent<unknown>) => {
    if (isAnswer(event.data)) answer(event.data)
  }
  // A worker that has fallen over is not a search failure worth reporting: the
  // next question opens a new one, and the field simply had no answer to this.
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
  const one = waiting.get(message.id)
  if (!one) return

  if (message.kind === 'done') {
    waiting.delete(message.id)
    one.done()
    return
  }

  one.onFound({ hits: message.hits, loose: message.loose })
}

/** Runs one search in the worker, resolving when the space has been read. */
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
    waiting.set(id, { onFound, done: resolve })
    open().postMessage({ id, root, query, terms, limit, excluded: [...excluded] })
  })
}
