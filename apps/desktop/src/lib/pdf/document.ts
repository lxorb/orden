/** pdf.js, and one PDF read through it.
 *
 *  The only file that touches the library, and the only one that knows where the
 *  bytes come from: the desktop hands them over from disk, the browser out of its
 *  own store. Everything above this works in pages, boxes and quads.
 *
 *  The library is imported when the first PDF is opened and not before. It is
 *  larger than the whole app around it, so a window that never opens a PDF never
 *  pays for one: the import below is what puts it in a chunk of its own. */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
// The worker is shipped as an asset of the build, so the URL is settled at build
// time and is the same one under Vite and inside the app bundle. Asking for the
// URL rather than importing the module keeps the worker out of the page.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { invoke, isDesktop } from '../tauri'

type Library = typeof import('pdfjs-dist')

let loading: Promise<Library> | null = null

/** The library, loaded once per window. */
export function pdfjs(): Promise<Library> {
  loading ??= import('pdfjs-dist').then((library) => {
    library.GlobalWorkerOptions.workerSrc = workerUrl
    return library
  })

  return loading
}

/** The bytes of a file in a space.
 *
 *  Over the IPC as bytes on the desktop, which is what makes a thirty megabyte
 *  PDF one copy rather than a hundred megabytes of JSON numbers. The browser
 *  keeps its files as text and answers with a `data:` URI, so there the bytes are
 *  decoded here. */
async function bytesOf(path: string): Promise<Uint8Array> {
  if (isDesktop) return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }))

  const uri = await invoke<string>('read_asset', { path })
  const binary = atob(uri.slice(uri.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  return bytes
}

/** A PDF that is open, and the one way to close it. */
export interface OpenPdf {
  doc: PDFDocumentProxy
  /** Gives the worker and the bytes back. The loading task rather than the
   *  document is what owns them, which is why closing lives here. */
  close: () => Promise<void>
}

/** Opens a PDF in a space. The library and the bytes are fetched at the same
 *  time, because the first page cannot be drawn until both are here. */
export async function openDocument(path: string): Promise<OpenPdf> {
  const [library, data] = await Promise.all([pdfjs(), bytesOf(path)])

  // The bytes are handed to the worker, which takes ownership of them: after
  // this the copy on this side is empty, and one document costs one copy.
  const task = library.getDocument({ data })

  return { doc: await task.promise, close: () => task.destroy() }
}

/** The words of a page, as the strings pdf.js lays one span out for: the same
 *  list, in the same order, that a rendered text layer holds in
 *  `textContentItemsStr`. That is what lets a match found in a page nobody is
 *  looking at be painted over the very nodes once it is on screen.
 *
 *  Reading them costs no drawing at all, which is what lets the find bar count
 *  through a document of three hundred pages. */
export async function textOf(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent()
  return content.items.flatMap((item) => ('str' in item ? [item.str] : []))
}
