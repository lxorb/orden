import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { door } from '@orden/markdown/door'
import { fileBytes, sha256 } from '../bytes'
import { PDF_TO_CSS } from './pages'

type Library = typeof import('pdfjs-dist')

export function current(scope: object = globalThis): boolean {
  const has = (name: string, member: string) => {
    const owner: unknown = Reflect.get(scope, name)
    return (
      (typeof owner === 'object' || typeof owner === 'function') &&
      owner !== null &&
      typeof Reflect.get(owner, member) === 'function'
    )
  }

  return has('Promise', 'try') && has('Uint8Array', 'fromBase64') && has('Math', 'sumPrecise')
}

export const pdfjs: () => Promise<Library> = door(() =>
  (current()
    ? import('pdfjs-dist').then((library) => ({ library, worker: workerUrl }))
    : import('pdfjs-dist/legacy/build/pdf.mjs').then((library) => ({
        library,
        worker: legacyWorkerUrl,
      }))
  ).then(({ library, worker }) => {
    library.GlobalWorkerOptions.workerSrc = worker
    return library
  }),
)

export function decodesImages(agent: string = navigator.userAgent): boolean {
  const webkit = agent.includes('AppleWebKit/') && !/(Chrome|Chromium|CriOS|Edg)\//.test(agent)
  return !webkit
}

export function loading(library: Library, data: Uint8Array) {
  return library.getDocument({ data, isImageDecoderSupported: decodesImages() })
}

export interface OpenPdf {
  doc: PDFDocumentProxy
  hash: string
  close: () => Promise<void>
}

export async function openDocument(path: string): Promise<OpenPdf> {
  const [library, data] = await Promise.all([pdfjs(), fileBytes(path)])
  return await opening(library, data)
}

export async function openBytes(data: Uint8Array): Promise<OpenPdf> {
  return await opening(await pdfjs(), data)
}

async function opening(library: Library, data: Uint8Array): Promise<OpenPdf> {
  const hash = await sha256(data)

  const task = loading(library, data)

  return { doc: await task.promise, hash, close: () => task.destroy() }
}

export async function pageSizes(
  from: string | Uint8Array,
): Promise<{ width: number; height: number }[]> {
  const opened =
    typeof from === 'string'
      ? await openDocument(from)
      : await pdfjs().then((library) => {
          const task = loading(library, from.slice())
          return task.promise.then((doc) => ({ doc, close: () => task.destroy() }))
        })

  try {
    const sizes: { width: number; height: number }[] = []
    for (let number = 1; number <= opened.doc.numPages; number += 1) {
      const page = await opened.doc.getPage(number)
      const view = page.getViewport({ scale: PDF_TO_CSS })
      sizes.push({ width: Math.round(view.width), height: Math.round(view.height) })
      page.cleanup()
    }
    return sizes
  } finally {
    await opened.close().catch(() => undefined)
  }
}

export async function textOf(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent()
  return content.items.flatMap((item) => ('str' in item ? [item.str] : []))
}
