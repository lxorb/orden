import type { PageNode } from '@orden/markdown/canvas'
import { openBytes, paperBytesOf, pdfjs } from '../../pdf/src/api'
import { fieldsOf, printedSize, type Read, scaled } from './page-fields'
import { sheetOf, wordsOn } from './page-fields-pdf'

export interface PaperPlace {
  note: string | null
  root: string | null
}
type PdfPage = import('pdfjs-dist').PDFPageProxy
async function eachPage<T>(
  pages: readonly PageNode[],
  place: PaperPlace,
  read: (page: PdfPage, sheet: PageNode) => Promise<T>,
): Promise<Map<string, T>> {
  const out = new Map<string, T>()
  const byFile = new Map<string, PageNode[]>()
  for (const page of pages) {
    if (!page.file || !page.page) continue
    const held = byFile.get(page.file)
    if (held) held.push(page)
    else byFile.set(page.file, [page])
  }
  for (const [file, sheets] of byFile) {
    const bytes = await paperBytesOf({ file, ...place }).catch(() => null)
    const held = bytes ? await openBytes(bytes).catch(() => null) : null
    if (!held) continue
    try {
      for (const sheet of sheets) {
        const number = sheet.page ?? 0
        if (number < 1 || number > held.doc.numPages) continue
        const page = await held.doc.getPage(number)
        try {
          out.set(sheet.id, await read(page, sheet))
        } catch {
          continue
        } finally {
          page.cleanup()
        }
      }
    } finally {
      await held.close()
    }
  }
  return out
}
const across = (sheet: PageNode, width: number) => (width > 0 ? sheet.width / width : 1)
export async function readsOf(pages: readonly PageNode[], place: PaperPlace): Promise<Map<string, Read>> {
  if (!pages.some((page) => page.file)) return new Map()
  const { OPS } = await pdfjs()
  return eachPage(pages, place, async (page, sheet) => {
    const read = fieldsOf(await sheetOf(page, OPS))
    return scaled(read, across(sheet, page.getViewport({ scale: 1 }).width))
  })
}
export async function sizesOf(pages: readonly PageNode[], place: PaperPlace): Promise<Map<string, number>> {
  return eachPage(pages, place, async (page, sheet) => {
    const { words, width } = await wordsOn(page)
    return Math.round(printedSize(words) * across(sheet, width) * 10) / 10
  })
}
