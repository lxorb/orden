import { type Parsed, parseMessage } from '@orden/chats/mime'

interface Said {
  id: number
  parsed?: Parsed
  error?: string
}

let worker: Worker | null = null
let asked = 0
const waiting = new Map<number, (said: Said) => void>()

function open(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./mail-parse-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  worker.onmessage = (event: MessageEvent<Said>) => {
    const one = waiting.get(event.data.id)
    waiting.delete(event.data.id)
    one?.(event.data)
  }
  worker.onerror = () => {
    const left = [...waiting.values()]
    waiting.clear()
    worker?.terminate()
    worker = null
    for (const one of left) one({ id: -1, error: 'the worker stopped' })
  }
  return worker
}

export function parsedOffThread(bytes: Uint8Array): Promise<Parsed> {
  const away = open()
  if (!away) return Promise.resolve(parseMessage(bytes))
  const id = ++asked
  return new Promise((resolve, reject) => {
    waiting.set(id, (said) => {
      if (said.parsed) resolve(said.parsed)
      else reject(new Error(said.error ?? 'not parsed'))
    })
    away.postMessage({ id, bytes })
  })
}
