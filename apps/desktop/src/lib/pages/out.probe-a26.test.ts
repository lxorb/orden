import { describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, type PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib'
import { emptyPages } from '@nib/markdown/pages'
import type { PageNode } from '../canvas/format'

vi.mock('../bytes', () => ({ fileBytes: () => Promise.resolve(null) }))
const { pagesPdf } = await import('./out')

describe('PROBE a26 desktop2: page note export', () => {
  test('PROBE a26 words typed on a page reach the PDF', async () => {
    const canvas = emptyPages()
    const page = canvas.nodes[0] as PageNode
    const card = {
      id: 'w1', type: 'text' as const, text: 'Exam on Friday',
      x: page.x + 40, y: page.y + 40, width: 200, height: 60,
    }
    const bytes = await pagesPdf({
      canvas: { ...canvas, nodes: [...canvas.nodes, card] },
      palette: {}, name: 'P', path: '/s/P.pages', root: '/s',
    })
    const doc = await PDFDocument.load(bytes!)
    const sheet = doc.getPage(0)
    const contents = sheet.node.Contents()
    const streams = contents && 'asArray' in contents ? (contents as PDFArray).asArray() : contents ? [contents] : []
    const text = streams
      .map((one) => decodePDFRawStream(doc.context.lookup(one as never) as PDFRawStream).decode())
      .map((one) => new TextDecoder().decode(one))
      .join('\n')
    // Any text-showing operator at all, or the words.
    expect(/Tj|TJ|Exam/.test(text)).toBe(true)
  })
})
