import { describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, degrees, type PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib'
import { emptyPages, pagesFromPdf } from '@orden/markdown/pages'
import type { Canvas, PageNode } from '../canvas/format'

const paper = vi.hoisted(() => ({ bytes: null as Uint8Array | null }))

vi.mock('../bytes', () => ({ fileBytes: () => Promise.resolve(paper.bytes) }))

const { pagesPdf } = await import('./out')

type Six = [number, number, number, number, number, number]

async function tapped(canvas: Canvas, x: number, y: number) {
  const page = canvas.nodes[0] as PageNode
  const point = { x: page.x + x, y: page.y + y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }
  const stroke = { id: 'a', tool: 'pen' as const, color: '#000000', size: 4, points: [point] }
  const out = { canvas: { ...canvas, ink: [stroke] }, palette: {}, name: 'Paper' }
  const bytes = await pagesPdf({ ...out, path: '/notes/Paper.canvas', root: '/notes' })
  const sheet = (await PDFDocument.load(bytes!)).getPage(0)
  const text = (sheet.node.Contents() as PDFArray)
    .asArray()
    .map((one) => decodePDFRawStream(sheet.doc.context.lookup(one) as PDFRawStream).decode())
    .map((one) => new TextDecoder().decode(one))
    .join('\n')

  const cms = [...text.matchAll(/(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm$/gm)]
  const points = [...text.matchAll(/(\S+) (\S+) [ml]$/gm)].map((one) =>
    cms.reduceRight<[number, number]>(
      (at, cm) => {
        const [p, r, s, t, u, v] = cm.slice(1).map(Number) as Six
        return [p * at[0] + s * at[1] + u, r * at[0] + t * at[1] + v]
      },
      one.slice(1).map(Number) as [number, number],
    ),
  )
  const middle = (axis: 0 | 1) => {
    const all = points.map((one) => one[axis])
    return (Math.min(...all) + Math.max(...all)) / 2
  }

  return { size: sheet.getSize(), at: { x: middle(0), y: middle(1) } }
}

describe('a page note as a PDF', () => {
  test('puts a page without a paper on a sheet of its size in points', async () => {
    const { size, at } = await tapped(emptyPages(), 200, 300)

    expect(size.width).toBeCloseTo(595.5, 1)
    expect(size.height).toBeCloseTo(842.25, 1)
    expect(at.x).toBeCloseTo(150, 0)
    expect(at.y).toBeCloseTo(size.height - 225, 0)
  })

  test('turns the ink with a paper that is turned', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595.28, 841.89]).setRotation(degrees(90))
    paper.bytes = await doc.save()
    const { at } = await tapped(pagesFromPdf('Paper.pdf', [{ width: 1123, height: 794 }]), 200, 300)

    expect(at.x).toBeCloseTo(225, 0)
    expect(at.y).toBeCloseTo(150, 0)
  })

  test('cuts a long page too tall for one sheet into sheets, each ruled by a pattern', async () => {
    const [page] = emptyPages('long').nodes as PageNode[]
    const long = { ...page!, height: 120000, pattern: 'dots' as const }
    const point = (y: number) => ({ x: long.x + 100, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 })
    const stroke = {
      id: 'low',
      tool: 'pen' as const,
      color: '#000000',
      size: 4,
      points: [point(long.y + 119000), point(long.y + 119100)],
    }
    const canvas = { ...emptyPages('long'), nodes: [long], ink: [stroke] }
    const bytes = await pagesPdf({
      canvas,
      palette: {},
      name: 'Long',
      path: '/notes/Long.canvas',
      root: '/notes',
    })
    const doc = await PDFDocument.load(bytes!)
    const sheets = doc.getPages()
    const text = (at: number) => {
      const sheet = sheets[at]!
      return (sheet.node.Contents() as PDFArray)
        .asArray()
        .map((one) => decodePDFRawStream(sheet.doc.context.lookup(one) as PDFRawStream).decode())
        .map((one) => new TextDecoder().decode(one))
        .join('\n')
    }

    expect(sheets).toHaveLength(7)
    expect(Math.max(...sheets.map((one) => one.getHeight()))).toBeLessThanOrEqual(14400)
    expect(text(0)).toContain('/Pattern cs')
    expect(text(0).length).toBeLessThan(2000)
    expect(text(0)).not.toMatch(/ l$/m)
    expect(text(6)).toMatch(/ l$/m)
  })
})
