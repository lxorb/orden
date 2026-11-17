import { type Cost, scrypt } from './scrypt'

interface Said {
  id: number
  key?: Uint8Array<ArrayBuffer>
  error?: string
}

type Waiting = (said: Said) => void

let worker: Worker | null = null
let asked = 0
const waiting = new Map<number, Waiting>()

function open(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./scrypt-worker.ts', import.meta.url), { type: 'module' })
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

export function scryptOffThread(
  password: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  cost: Cost,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const away = open()
  if (!away) return scrypt(password, salt, cost, length)
  const id = ++asked
  return new Promise((resolve, reject) => {
    waiting.set(id, (said) => {
      if (said.key) resolve(said.key)
      else reject(new Error(said.error ?? 'no key'))
    })
    away.postMessage({ id, password, salt, cost: { n: cost.n, r: cost.r, p: cost.p }, length })
  })
}
