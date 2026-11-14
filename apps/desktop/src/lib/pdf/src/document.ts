import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { door } from '@orden/markdown/door'
import { fileBytes, sha256 } from '../../platform/src/api'
import { PDF_TO_CSS } from './pages'
import { streamsIterate } from './streams'
import { current, decodesImages } from './engine'

type Library = typeof import('pdfjs-dist')

export const pdfjs: () => Promise<Library> = door(() =>
  (current()
    ? import('pdfjs-dist').then((library) => ({ library, worker: workerUrl }))
    : import('pdfjs-dist/legacy/build/pdf.mjs').then((library) => ({
        library,
        worker: legacyWorkerUrl,
      }))
  ).then(({ library, worker }) => {
    streamsIterate()
    library.GlobalWorkerOptions.workerSrc = worker
    return library
  }),
)

let shared: { library: Library; worker: InstanceType<Library['PDFWorker']> } | null = null

function workerOf(library: Library): InstanceType<Library['PDFWorker']> {
  if (shared?.library === library && !shared.worker.destroyed) return shared.worker

  const made = { library, worker: new library.PDFWorker() }
  shared = made
  made.worker.promise.catch(() => {
    if (shared === made) shared = null
  })
  return made.worker
}

export function warmPdf(): void {
  void pdfjs()
    .then(workerOf)
    .catch(() => undefined)
}

export function loading(library: Library, data: Uint8Array) {
  return library.getDocument({
    data,
    isImageDecoderSupported: decodesImages(),
    worker: workerOf(library),
  })
}

export interface OpenPdf {
  doc: PDFDocumentProxy
  hash: string
  close: () => Promise<void>
}

const LENT_FOR = 10_000

const lent = new Map<string, { opened: OpenPdf; timer: ReturnType<typeof setTimeout> }>()

function lend(path: string, opened: OpenPdf) {
  const before = lent.get(path)
  if (before) {
    clearTimeout(before.timer)
    if (before.opened !== opened) void before.opened.close().catch(() => undefined)
  }

  const timer = setTimeout(() => {
    if (lent.get(path)?.opened !== opened) return
    lent.delete(path)
    void opened.close().catch(() => undefined)
  }, LENT_FOR)
  lent.set(path, { opened, timer })
}

export function lentMoved(from: string, to: string) {
  const held = lent.get(from)
  if (!held) return

  lent.delete(from)
  clearTimeout(held.timer)
  lend(to, held.opened)
}

export async function openDocument(path: string): Promise<OpenPdf> {
  const held = lent.get(path)
  if (held) {
    lent.delete(path)
    clearTimeout(held.timer)
    return held.opened
  }

  const [library, data] = await Promise.all([pdfjs(), fileBytes(path)])
  return await opening(library, data)
}

export async function openBytes(data: Uint8Array): Promise<OpenPdf> {
  return await opening(await pdfjs(), data)
}

async function opening(library: Library, data: Uint8Array): Promise<OpenPdf> {
  const hash = await sha256(data)

  const task = loading(library, data)

  const doc = await task.promise
  return { doc, hash, close: () => task.destroy() }
}

const AT_ONCE = 200

export async function pageSizes(
  from: string | Uint8Array,
): Promise<{ width: number; height: number }[]> {
  if (typeof from !== 'string') {
    const opened = await pdfjs().then((library) => {
      const task = loading(library, from.slice())
      return task.promise.then((doc) => ({ doc, close: () => task.destroy() }))
    })
    try {
      return await sizesOf(opened.doc)
    } finally {
      await opened.close().catch(() => undefined)
    }
  }

  const opened = await openDocument(from)
  try {
    const sizes = await sizesOf(opened.doc)
    lend(from, opened)
    return sizes
  } catch (error) {
    await opened.close().catch(() => undefined)
    throw error
  }
}

async function sizesOf(doc: PDFDocumentProxy): Promise<{ width: number; height: number }[]> {
  const sizes: { width: number; height: number }[] = []
  for (let from = 1; from <= doc.numPages; from += AT_ONCE) {
    const numbers = Array.from(
      { length: Math.min(AT_ONCE, doc.numPages - from + 1) },
      (_unused, at) => from + at,
    )
    for (const page of await Promise.all(numbers.map((one) => doc.getPage(one)))) {
      const view = page.getViewport({ scale: PDF_TO_CSS })
      sizes.push({ width: Math.round(view.width), height: Math.round(view.height) })
      page.cleanup()
    }
  }
  return sizes
}

export async function textOf(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent()
  return content.items.flatMap((item) => ('str' in item ? [item.str] : []))
}
