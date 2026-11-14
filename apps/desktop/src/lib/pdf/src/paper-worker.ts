import * as library from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as engine from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { decodesImages } from './engine'
import { streamsIterate } from './streams'
import type { AwayAsked, AwaySaid } from './paper-away'

Object.assign(globalThis, { pdfjsWorker: engine })
streamsIterate()

const drawing = { filtered: false }

function filtersUsed(): boolean {
  return drawing.filtered
}

class NoFilters {
  addFilter(maps: unknown) {
    if (maps) drawing.filtered = true
    return 'none'
  }
  addHCMFilter() {
    return 'none'
  }
  addAlphaFilter() {
    drawing.filtered = true
    return 'none'
  }
  addLuminosityFilter() {
    drawing.filtered = true
    return 'none'
  }
  addKnockoutFilter() {
    drawing.filtered = true
    return 'none'
  }
  addHighlightHCMFilter() {
    return 'none'
  }
  addSelectionHCMFilter() {
    return 'none'
  }
  addSelectionFilter() {
    return 'none'
  }
  createSelectionStyle() {
    return null
  }
  destroy() {
    return undefined
  }
}

const fonts = (globalThis as { fonts?: unknown }).fonts

const owner = {
  fonts,
  createElement: () => new OffscreenCanvas(1, 1),
}

const docs = new Map<number, { task: PDFDocumentLoadingTask; doc: Promise<PDFDocumentProxy> }>()

const running = new Map<number, RenderTask>()

const dropped = new Set<number>()

let line: Promise<unknown> = Promise.resolve()

function open(doc: number, bytes: ArrayBuffer) {
  const task = library.getDocument({
    data: new Uint8Array(bytes),
    ownerDocument: owner,
    FilterFactory: NoFilters,
    isOffscreenCanvasSupported: true,
    isImageDecoderSupported: decodesImages(navigator.userAgent),
    disableFontFace: !fonts,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof library.getDocument>[0])
  docs.set(doc, { task, doc: task.promise })
}

function close(doc: number) {
  const held = docs.get(doc)
  docs.delete(doc)
  void held?.task.destroy().catch(() => undefined)
}

async function draw(asked: Extract<AwayAsked, { kind: 'draw' }>): Promise<AwaySaid> {
  const { id } = asked
  if (dropped.delete(id)) return { id, image: null, here: false }

  const held = docs.get(asked.doc)
  if (!held) return { id, image: null, here: true }

  const doc = await held.doc
  const page = await doc.getPage(asked.number)
  const view = page.getViewport({
    scale: asked.scale,
    offsetX: asked.offsetX,
    offsetY: asked.offsetY,
  })
  const sheet = new OffscreenCanvas(asked.width, asked.height)
  const context = sheet.getContext('2d')
  if (!context) {
    page.cleanup()
    return { id, image: null, here: true }
  }

  drawing.filtered = false
  const task = page.render({
    canvas: sheet as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport: view,
  })
  running.set(id, task)
  try {
    await task.promise
  } catch {
    return { id, image: null, here: !dropped.delete(id) }
  } finally {
    running.delete(id)
    page.cleanup()
  }
  if (dropped.delete(id)) return { id, image: null, here: false }
  if (filtersUsed()) return { id, image: null, here: true }

  return { id, image: sheet.transferToImageBitmap(), here: false }
}

self.onmessage = (event: MessageEvent<AwayAsked>) => {
  const asked = event.data
  switch (asked.kind) {
    case 'open':
      open(asked.doc, asked.bytes)
      return
    case 'close':
      close(asked.doc)
      return
    case 'drop':
      dropped.add(asked.id)
      running.get(asked.id)?.cancel()
      return
    case 'draw':
      line = line.then(() =>
        draw(asked).then(
          (said) => self.postMessage(said, { transfer: said.image ? [said.image] : [] }),
          () => self.postMessage({ id: asked.id, image: null, here: true }),
        ),
      )
  }
}
