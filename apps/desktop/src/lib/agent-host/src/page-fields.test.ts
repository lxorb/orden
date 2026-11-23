import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { type Box, fieldsOf, scaled, type Sheet, type Words } from './page-fields'
import { marksOf, sheetOf } from './page-fields-pdf'

const SIZE = 11
const LINE = 14
function words(text: string, x: number, y: number, size = SIZE): Words {
  return { text, size, box: { x, y, width: text.length * size * 0.5, height: size } }
}
function sheet(over: Partial<Sheet>): Sheet {
  return { width: 595, height: 842, words: [], widgets: [], marks: [], ...over }
}
const QUESTIONS = [
  { text: '1. What does a prism do to white light?', y: 100 },
  { text: '2. Why is the sky blue?', y: 300 },
  { text: '3. Name two lenses.', y: 500 },
]
const worksheet = (extra: Words[] = []) =>
  sheet({
    words: [
      words('Optics worksheet', 72, 60, 16),
      ...QUESTIONS.map((one) => words(one.text, 72, one.y)),
      words('Page 1', 280, 760, 9),
      ...extra,
    ],
  })
const within = (box: Box, outer: Box) =>
  box.x >= outer.x &&
  box.y >= outer.y &&
  box.x + box.width <= outer.x + outer.width &&
  box.y + box.height <= outer.y + outer.height

describe('the answer spaces of a printed page', () => {
  test('are the gaps under each question, each with its question, and the size of the words is the body text', () => {
    const read = fieldsOf(worksheet())
    expect(read.size).toBe(SIZE)
    expect(read.fields.map((one) => [one.kind, one.question])).toEqual(QUESTIONS.map((one) => ['gap', one.text]))
    const [first, second] = read.fields
    expect(first!.y).toBeGreaterThan(100 + SIZE)
    expect(first!.y + first!.height).toBeLessThan(300)
    expect(second!.y).toBeGreaterThan(300)
  })
  test('take the lines of a question that runs over two lines, and leave the gap between them alone', () => {
    const read = fieldsOf(
      sheet({
        words: [
          words('1. Explain why a rainbow', 72, 100),
          words('shows its colours in order.', 72, 100 + LINE),
          words('2. Next question.', 72, 400),
        ],
      }),
    )
    expect(read.fields[0]?.question).toBe('1. Explain why a rainbow shows its colours in order.')
    expect(read.fields).toHaveLength(2)
  })
  test('are the fields of the form when the PDF has one, and nothing else', () => {
    const read = fieldsOf({
      ...worksheet(),
      widgets: [{ name: 'answer1', box: { x: 72, y: 120, width: 400, height: 100 } }],
    })
    expect(read.fields).toEqual([
      { kind: 'form', name: 'answer1', x: 72, y: 120, width: 400, height: 100, question: QUESTIONS[0]!.text },
    ])
  })
  test('are an empty box drawn under a question, in place of the gap round it', () => {
    const box = { x: 72, y: 130, width: 450, height: 120 }
    const read = fieldsOf({ ...worksheet(), marks: [{ box, picture: false }] })
    const [first] = read.fields
    expect(first?.kind).toBe('box')
    expect(first?.question).toBe(QUESTIONS[0]!.text)
    expect(within(first!, box)).toBe(true)
    expect(read.fields.filter((one) => one.kind === 'gap')).toHaveLength(2)
  })
  test('leave out a box with words in it and a gap a picture fills', () => {
    const framed = { x: 60, y: 90, width: 470, height: 40 }
    const picture = { x: 72, y: 330, width: 450, height: 150 }
    const read = fieldsOf({
      ...worksheet(),
      marks: [
        { box: framed, picture: false },
        { box: picture, picture: true },
      ],
    })
    expect(read.fields.map((one) => one.kind)).toEqual(['gap', 'gap'])
    expect(read.fields.map((one) => one.question)).toEqual([QUESTIONS[0]!.text, QUESTIONS[2]!.text])
  })
  test('are a line of blanks, with the words before it on its row', () => {
    const read = fieldsOf(
      sheet({ words: [words('Name:', 72, 100), words('______________________', 110, 100), words('Next', 72, 700)] }),
    )
    const blank = read.fields.find((one) => one.kind === 'blank')
    expect(blank?.question).toBe('Name:')
    expect(blank?.x).toBe(110)
  })
  test('come in the units of the page note', () => {
    const read = scaled(fieldsOf(worksheet()), 2048 / 595)
    expect(read.size).toBeCloseTo((SIZE * 2048) / 595, 1)
    expect(read.fields[0]!.x).toBe(Math.round((72 * 2048) / 595))
  })
})
describe('a real PDF', () => {
  async function pdf(form: boolean): Promise<Uint8Array> {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const one of QUESTIONS) page.drawText(one.text, { x: 72, y: 842 - one.y - SIZE, size: SIZE, font })
    page.drawRectangle({ x: 72, y: 842 - 760, width: 450, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('4. Draw a ray through a lens.', { x: 72, y: 842 - 590 - SIZE, size: SIZE, font })
    if (form) {
      const field = doc.getForm().createTextField('first')
      field.addToPage(page, { x: 72, y: 842 - 250, width: 450, height: 120 })
    }
    return doc.save()
  }
  async function read(bytes: Uint8Array) {
    const library = await import('pdfjs-dist/legacy/build/pdf.mjs')
    library.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
    )
    const task = library.getDocument({ data: bytes, disableFontFace: true })
    const doc = await task.promise
    try {
      return fieldsOf(await sheetOf(await doc.getPage(1), library.OPS))
    } finally {
      await task.destroy()
    }
  }
  test('gives the gaps under its three questions and the empty box under the fourth', async () => {
    const found = await read(await pdf(false))
    expect(found.size).toBeCloseTo(SIZE, 0)
    expect(found.fields.map((one) => [one.kind, one.question])).toEqual([
      ...QUESTIONS.map((one) => ['gap', one.text]),
      ['box', '4. Draw a ray through a lens.'],
    ])
    const box = found.fields[3]!
    expect(within(box, { x: 72, y: 640, width: 450, height: 120 })).toBe(true)
  })
  test('gives its form field with the question above it', async () => {
    const found = await read(await pdf(true))
    expect(found.fields).toHaveLength(1)
    const [field] = found.fields
    expect(field).toMatchObject({ kind: 'form', name: 'first', question: QUESTIONS[0]!.text })
    expect(Math.abs(field!.x - 72)).toBeLessThan(2)
    expect(Math.abs(field!.y - (250 - 120))).toBeLessThan(2)
  })
})
describe('the marks drawn on a page', () => {
  const OPS = {
    save: 1,
    restore: 2,
    transform: 3,
    constructPath: 4,
    stroke: 5,
    paintFormXObjectBegin: 6,
    paintFormXObjectEnd: 7,
    beginAnnotation: 8,
    endAnnotation: 9,
    paintImageXObject: 10,
    paintImageXObjectRepeat: 11,
  }
  const path = (x0: number, y0: number, x1: number, y1: number) => [
    OPS.stroke,
    [null],
    new Float32Array([x0, y0, x1, y1]),
  ]
  test('sit where a form or an annotation moves them, and every picture of a repeat counts', () => {
    const marks = marksOf(
      [6, 4, 7, 8, 4, 9, 11],
      [
        [new Float32Array([0.5, 0, 0, 0.5, 50, 20]), null],
        path(100, 400, 400, 600),
        [],
        ['a1', [0, 0, 10, 10], [1, 0, 0, 1, 200, 300], [2, 0, 0, 2, 0, 0], false],
        path(0, 0, 10, 10),
        [],
        ['img', 10, 10, [5, 5, 30, 30]],
      ],
      OPS,
      [1, 0, 0, 1, 0, 0],
    )
    expect(marks.map((one) => [one.box, one.picture])).toEqual([
      [{ x: 100, y: 220, width: 150, height: 100 }, false],
      [{ x: 200, y: 300, width: 20, height: 20 }, false],
      [{ x: 5, y: 5, width: 10, height: 10 }, true],
      [{ x: 30, y: 30, width: 10, height: 10 }, true],
    ])
  })
})
