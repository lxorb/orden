/** A PDF's own table of contents, as the Outline lists it (#1120): what the file says
 *  its parts are called and which page each starts on, a step in for each level.
 *
 *  Read once the viewer has the document open, because that is when there is a
 *  document to ask, and kept by the viewer's tab for as long as it has the document, so
 *  the Outline beside a PDF reads the same rows as long as it is open. A PDF that
 *  wrote no outline has none, and the Outline is not offered beside it; see
 *  panel-tab.ts. */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { SvelteMap } from 'svelte/reactivity'

/** One part of the PDF: its name, the page it starts on (from 1) and how deep it is. */
export interface PdfHeading {
  title: string
  page: number
  level: number
}

/** The most rows read: a reference book's index written as an outline is not a
 *  table of contents anybody reads down. */
const MOST = 2000

/** What pdf.js answers for a part: its name, where it goes, and the parts inside it. */
interface Item {
  title: string
  dest: string | unknown[] | null
  items: Item[]
}

type Reading = Pick<PDFDocumentProxy, 'getOutline' | 'getDestination' | 'getPageIndex'>

/** The parts, in reading order, each with its page. A part whose page cannot be found
 *  is left out rather than sent to the first page. */
export async function readOutline(doc: Reading): Promise<PdfHeading[]> {
  const top = ((await doc.getOutline().catch(() => null)) ?? []) as Item[]
  const out: PdfHeading[] = []

  const walk = async (items: readonly Item[], level: number) => {
    for (const item of items) {
      if (out.length >= MOST) return
      const page = await pageOf(doc, item.dest)
      const title = item.title.trim()
      if (page !== null && title) out.push({ title, page, level })
      if (item.items.length) await walk(item.items, level + 1)
    }
  }

  await walk(top, 0)
  return out
}

async function pageOf(doc: Reading, dest: Item['dest']): Promise<number | null> {
  try {
    const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    const ref: unknown = Array.isArray(explicit) ? explicit[0] : null
    if (typeof ref === 'number') return ref + 1
    if (ref && typeof ref === 'object') {
      return (await doc.getPageIndex(ref as Parameters<Reading['getPageIndex']>[0])) + 1
    }
    return null
  } catch {
    return null
  }
}

/** Each open PDF's outline, by the id of the tab showing it. */
export const pdfOutlines = new SvelteMap<string, readonly PdfHeading[]>()
