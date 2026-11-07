import {
  dataUrlOf,
  type Drawing,
  pageSheet,
  type Picture,
  redrawn,
  sheetDrawing,
} from './feedback-pictures'

interface Said {
  id: number
  dataUrl?: string | null
  unable?: boolean
}

let worker: Worker | null = null
let unable = false
let asked = 0
const waiting = new Map<number, (said: Said) => void>()
let turn: Promise<unknown> = Promise.resolve()
let made = 0

function open(): Worker | null {
  if (unable || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./picture-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    unable = true
    return null
  }
  worker.onmessage = (event: MessageEvent<Said>) => {
    if (event.data.unable) {
      unable = true
      worker?.terminate()
      worker = null
    }
    const one = waiting.get(event.data.id)
    waiting.delete(event.data.id)
    one?.(event.data)
  }
  worker.onerror = () => {
    const left = [...waiting.entries()]
    waiting.clear()
    worker?.terminate()
    worker = null
    unable = true
    for (const [id, one] of left) one({ id, unable: true })
  }
  return worker
}

async function drawnHere(file: Blob, drawing: Drawing): Promise<string | null> {
  const drawn = await redrawn(file, drawing)
  return drawn ? await dataUrlOf(drawn.blob, drawn.type) : null
}

function drawnAway(file: Blob): Promise<string | null> {
  const away = open()
  if (!away) return drawnHere(file, sheetDrawing(pageSheet))
  const id = ++asked
  return new Promise((resolve, reject) => {
    waiting.set(id, (said) => {
      if (said.unable) drawnHere(file, sheetDrawing(pageSheet)).then(resolve, reject)
      else resolve(said.dataUrl ?? null)
    })
    away.postMessage({ id, file })
  })
}

export function pictureOf(file: Blob, drawing?: Drawing): Promise<Picture | null> {
  const drawn = turn.then(() => (drawing ? drawnHere(file, drawing) : drawnAway(file)))
  turn = drawn.catch(() => null)
  return drawn.then((dataUrl) => {
    if (!dataUrl) return null
    made++
    return { id: `picture-${String(made)}`, dataUrl, preview: dataUrl }
  })
}
