import { toBase64 } from './bytes'

interface Said {
  id: number
  png: string | null
}

interface Waiting {
  canvas: HTMLCanvasElement
  done: (png: string | null) => void
}

let worker: Worker | null = null
let broken = false
let asked = 0
const waiting = new Map<number, Waiting>()

async function here(canvas: HTMLCanvasElement): Promise<string | null> {
  const png = await new Promise<Blob | null>((done) => {
    canvas.toBlob(done, 'image/png')
  })
  if (!png) return null
  if (typeof FileReader === 'undefined') {
    return `data:image/png;base64,${toBase64(new Uint8Array(await png.arrayBuffer()))}`
  }
  return new Promise((done) => {
    const reader = new FileReader()
    reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => done(null)
    reader.readAsDataURL(png)
  })
}

function open(): Worker | null {
  if (worker) return worker
  if (
    broken ||
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof createImageBitmap !== 'function'
  ) {
    return null
  }
  try {
    worker = new Worker(new URL('./png-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    broken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<Said>) => {
    const one = waiting.get(event.data.id)
    waiting.delete(event.data.id)
    if (!one) return
    if (event.data.png) one.done(event.data.png)
    else void here(one.canvas).then(one.done)
  }
  worker.onerror = () => {
    const left = [...waiting.values()]
    waiting.clear()
    worker?.terminate()
    worker = null
    broken = true
    for (const one of left) void here(one.canvas).then(one.done)
  }
  return worker
}

export async function pngData(canvas: HTMLCanvasElement): Promise<string | null> {
  const away = open()
  if (!away) return here(canvas)
  let picture: ImageBitmap
  try {
    picture = await createImageBitmap(canvas)
  } catch {
    return here(canvas)
  }
  const id = ++asked
  return new Promise((done) => {
    waiting.set(id, { canvas, done })
    away.postMessage({ id, picture }, [picture])
  })
}
