import { mark } from '../trace'

export interface AwayDraw {
  number: number
  scale: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export type AwayAsked =
  | { kind: 'open'; doc: number; bytes: ArrayBuffer }
  | { kind: 'close'; doc: number }
  | { kind: 'drop'; id: number }
  | ({ kind: 'draw'; id: number; doc: number } & AwayDraw)

export interface AwaySaid {
  id: number
  image: ImageBitmap | null
  here: boolean
}

export const HERE = 'here'

type Drawn = ImageBitmap | null | typeof HERE

let worker: Worker | null = null
let broken = false
let asked = 0
let docs = 0
const waiting = new Map<number, (drawn: Drawn) => void>()

function opened(): Worker | null {
  if (worker) return worker
  if (broken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return null
  }
  try {
    worker = new Worker(new URL('./paper-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    broken = true
    return null
  }
  mark('paper drawn away')
  worker.onmessage = (event: MessageEvent<AwaySaid>) => {
    const { id, image, here } = event.data
    const done = waiting.get(id)
    waiting.delete(id)
    if (done) done(here ? HERE : image)
    else image?.close()
  }
  worker.onerror = () => {
    worker?.terminate()
    worker = null
    broken = true
    const left = [...waiting.values()]
    waiting.clear()
    for (const done of left) done(HERE)
  }
  return worker
}

export function drawsAway(): boolean {
  return opened() !== null
}

export function openAway(bytes: Uint8Array): number | null {
  const away = opened()
  if (!away) return null

  const doc = ++docs
  const copy = bytes.slice().buffer
  away.postMessage({ kind: 'open', doc, bytes: copy } satisfies AwayAsked, [copy])
  return doc
}

export function closeAway(doc: number): void {
  worker?.postMessage({ kind: 'close', doc } satisfies AwayAsked)
}

export function drawAway(doc: number, draw: AwayDraw, signal?: AbortSignal): Promise<Drawn> {
  const away = opened()
  if (!away) return Promise.resolve(HERE)
  if (signal?.aborted) return Promise.resolve(null)

  const id = ++asked
  return new Promise<Drawn>((done) => {
    const drop = () => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      worker?.postMessage({ kind: 'drop', id } satisfies AwayAsked)
      done(null)
    }
    waiting.set(id, (drawn) => {
      signal?.removeEventListener('abort', drop)
      done(drawn)
    })
    signal?.addEventListener('abort', drop, { once: true })
    away.postMessage({ kind: 'draw', id, doc, ...draw } satisfies AwayAsked)
  })
}
