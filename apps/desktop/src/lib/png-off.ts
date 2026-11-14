import { toBase64 } from './platform/src/api'

type As = 'data' | 'bytes'

interface Said {
  id: number
  png: string | ArrayBuffer | null
}

type Png = string | Uint8Array | null

type Draw = (drawing: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void

interface Waiting {
  again: () => Promise<Png>
  done: (png: Png) => void
}

let worker: Worker | null = null
let broken = false
let asked = 0
const waiting = new Map<number, Waiting>()

async function blobHere(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((done) => {
    canvas.toBlob(done, 'image/png')
  })
}

async function dataOf(png: Blob): Promise<string | null> {
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

async function here(canvas: HTMLCanvasElement, as: As): Promise<Png> {
  const png = await blobHere(canvas)
  if (!png) return null
  return as === 'bytes' ? new Uint8Array(await png.arrayBuffer()) : dataOf(png)
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
    const { png } = event.data
    if (png === null) void one.again().then(one.done)
    else one.done(typeof png === 'string' ? png : new Uint8Array(png))
  }
  worker.onerror = () => {
    const left = [...waiting.values()]
    waiting.clear()
    worker?.terminate()
    worker = null
    broken = true
    for (const one of left) void one.again().then(one.done)
  }
  return worker
}

function away(
  picture: ImageBitmap,
  as: As,
  again: () => Promise<Png>,
  worker: Worker,
): Promise<Png> {
  const id = ++asked
  return new Promise((done) => {
    waiting.set(id, { again, done })
    worker.postMessage({ id, picture, as }, [picture])
  })
}

async function encoded(canvas: HTMLCanvasElement, as: As): Promise<Png> {
  const worker = open()
  if (!worker) return here(canvas, as)
  let picture: ImageBitmap
  try {
    picture = await createImageBitmap(canvas)
  } catch {
    return here(canvas, as)
  }
  return away(picture, as, () => here(canvas, as), worker)
}

function drawnHere(width: number, height: number, draw: Draw): Promise<Png> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const drawing = canvas.getContext('2d')
  if (!drawing) return Promise.resolve(null)
  draw(drawing)
  return here(canvas, 'bytes')
}

export async function pngData(canvas: HTMLCanvasElement): Promise<string | null> {
  const png = await encoded(canvas, 'data')
  return typeof png === 'string' ? png : null
}

export async function pngDrawn(
  width: number,
  height: number,
  paint: () => Promise<Draw>,
): Promise<Uint8Array | null> {
  const again = async () => drawnHere(width, height, await paint())
  const worker = open()
  const sheet = worker ? new OffscreenCanvas(width, height) : null
  const drawing = sheet?.getContext('2d')
  if (!worker || !sheet || !drawing) {
    const png = await again()
    return png instanceof Uint8Array ? png : null
  }
  const draw = await paint()
  draw(drawing)
  const png = await away(sheet.transferToImageBitmap(), 'bytes', again, worker)
  return png instanceof Uint8Array ? png : null
}
