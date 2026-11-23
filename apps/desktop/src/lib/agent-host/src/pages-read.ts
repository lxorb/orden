import type { PageNode } from '@orden/markdown/canvas'
import { openBytes, paperBytesOf, pdfjs } from '../../pdf/src/api'
import { fieldsOf, type Read, scaled } from './page-fields'
import { sheetOf } from './page-fields-pdf'

export interface PaperPlace {
  note: string | null
  root: string | null
}
export async function readsOf(pages: readonly PageNode[], place: PaperPlace): Promise<Map<string, Read>> {
  const out = new Map<string, Read>()
  const byFile = new Map<string, PageNode[]>()
  for (const page of pages) {
    if (!page.file || !page.page) continue
    const held = byFile.get(page.file)
    if (held) held.push(page)
    else byFile.set(page.file, [page])
  }
  if (!byFile.size) return out
  const { OPS } = await pdfjs()
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
          const read = fieldsOf(await sheetOf(page, OPS))
          const across = page.getViewport({ scale: 1 }).width
          out.set(sheet.id, scaled(read, across > 0 ? sheet.width / across : 1))
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
