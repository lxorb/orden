import type { PDFDocumentProxy } from 'pdfjs-dist'
import { SvelteMap } from 'svelte/reactivity'

export interface PdfHeading {
  title: string
  page: number
  level: number
}

const MOST = 2000

interface Item {
  title: string
  dest: string | unknown[] | null
  items: Item[]
}

type Reading = Pick<PDFDocumentProxy, 'getOutline' | 'getDestination' | 'getPageIndex'>

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

export const pdfOutlines = new SvelteMap<string, readonly PdfHeading[]>()
