import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  boxOf,
  emptySheet,
  frozen,
  type Highlight,
  matrixOf,
  type Quad,
  readSheet,
  SIDECAR,
  toViewport,
  type Transform,
  writeSheet,
} from './highlights'

const mark = (over: Partial<Highlight> = {}): Highlight => ({
  id: 'abc123',
  page: 3,
  text: 'the selected words',
  quads: [[100, 712, 200, 712, 200, 700, 100, 700]],
  colour: 0,
  created: 1_700_000_000_000,
  ...over,
})
describe('the sidecar', () => {
  test('is named after the PDF, under the name the Rust side writes', () => {
    const paths = readFileSync(
      fileURLToPath(new URL('../../../../src-tauri/crates/base/src/paths.rs', import.meta.url)),
      'utf8',
    )
    expect(SIDECAR).toBe('.highlights.json')
    expect(paths).toContain(`pub const HIGHLIGHTS: &str = "${SIDECAR}";`)
  })
  test('reads as no marks when there is nothing to read', () => {
    expect(readSheet('')).toEqual(emptySheet())
    expect(readSheet('   \n')).toEqual(emptySheet())
    expect(readSheet('{}').highlights).toEqual([])
  })
  test('goes there and back unchanged', () => {
    const written = writeSheet({ version: 1, highlights: [mark()] })
    expect(readSheet(written).highlights).toEqual([mark()])
  })
  test('is written in reading order, however the marks arrived', () => {
    const sheet = {
      version: 1,
      highlights: [
        mark({ id: 'c', page: 9 }),
        mark({ id: 'a', page: 2 }),
        mark({ id: 'b', page: 2, created: 1_700_000_000_001 }),
      ],
    }
    expect(readSheet(writeSheet(sheet)).highlights.map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })
  test('is text a person can read, and ends in a newline', () => {
    const written = writeSheet({ version: 1, highlights: [mark()] })
    expect(written).toContain('\n  "version": 1')
    expect(written.endsWith('\n')).toBe(true)
  })
  test('is nothing at all for a PDF with no marks left, so the file goes', () => {
    expect(writeSheet(emptySheet())).toBe('')
  })
  test('keeps the marks it understands and drops the ones it does not', () => {
    const text = JSON.stringify({
      version: 1,
      highlights: [
        mark(),
        { ...mark({ id: 'x' }), page: 0 },
        { ...mark({ id: 'y' }), quads: [] },
        { ...mark({ id: 'z' }), quads: [[1, 2, 3]] },
        { ...mark({ id: 'w' }), quads: [[1, 2, 3, 4, 5, 6, 7, 'eight']] },
        'not a mark at all',
      ],
    })
    expect(readSheet(text).highlights.map((one) => one.id)).toEqual(['abc123'])
  })
  test('fills in what a mark left out', () => {
    const text = JSON.stringify({
      highlights: [{ page: 4, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }],
    })
    const [only] = readSheet(text).highlights
    expect(only).toMatchObject({ page: 4, text: '', colour: 0, created: 0 })
    expect(only?.id).toBeTruthy()
  })
  test('holds a colour to one this build knows', () => {
    const of = (colour: unknown) =>
      readSheet(JSON.stringify({ highlights: [{ ...mark(), colour }] })).highlights[0]?.colour
    expect(of(1)).toBe(1)
    expect(of(99)).toBe(2)
    expect(of(-4)).toBe(0)
    expect(of('red')).toBe(0)
  })
})
describe('a sidecar this build did not write', () => {
  test('from a later version is left exactly as it is', () => {
    const sheet = readSheet(JSON.stringify({ version: 99, highlights: [mark()] }))
    expect(frozen(sheet)).toBe('newer')
    expect(sheet.highlights).toHaveLength(1)
  })
  test('that is not JSON at all is left alone too', () => {
    expect(frozen(readSheet('this is not a sidecar'))).toBe('damaged')
  })
  test('and one this build wrote is not frozen', () => {
    expect(frozen(readSheet(writeSheet({ version: 1, highlights: [mark()] })))).toBeNull()
    expect(frozen(emptySheet())).toBeNull()
  })
})
const TWICE: Transform = [2, 0, 0, -2, 0, 792 * 2]
describe('a mark on the page it is drawn on', () => {
  test('is the box its quad covers, in CSS pixels from the corner', () => {
    const quad: Quad = [100, 712, 200, 712, 200, 700, 100, 700]
    expect(boxOf(quad, toViewport(TWICE))).toEqual({
      left: 200,
      top: 160,
      width: 200,
      height: 24,
    })
  })
  test('all four corners, so a turned page comes out right', () => {
    const turned: Transform = [0, 1, 1, 0, 0, 0]
    expect(boxOf([10, 20, 30, 20, 30, 40, 10, 40], toViewport(turned))).toEqual({
      left: 20,
      top: 10,
      width: 20,
      height: 20,
    })
  })
  test('a transform with nothing in it changes nothing', () => {
    expect(matrixOf([])).toEqual([1, 0, 0, 1, 0, 0])
    expect(matrixOf([3, 0, 0, 3, 5, 7])).toEqual([3, 0, 0, 3, 5, 7])
    expect(toViewport(matrixOf([]))(4, 9)).toEqual([4, 9])
  })
})
