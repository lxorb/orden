import { describe, expect, test } from 'vitest'
import {
  canPrint,
  EXPORT_FORMATS,
  EXPORT_KEYS,
  EXPORT_VARIANTS,
  exportKindOf,
  extensionFor,
  isNoteFormat,
  labelOf,
  offeredBy,
  PANDOC_FORMATS,
  printable,
} from '../src/api'

test('the module stands on its own the catalogue loads without a window', () => {
  expect(canPrint).toBe(false)
})
describe('the formats', () => {
  test('a note is offered every format and variant, each once, and each is a note format', () => {
    const offered = offeredBy('note')
    expect(offered).toEqual([...EXPORT_FORMATS, ...EXPORT_VARIANTS].map((one) => one.id))
    expect(new Set(offered).size).toBe(offered.length)
    expect(offered.every((id) => isNoteFormat(id))).toBe(true)
  })
  test('the shortcut keys name each format and the extras once', () => {
    expect(new Set(EXPORT_KEYS).size).toBe(EXPORT_KEYS.length)
    expect(EXPORT_KEYS).toContain('copy')
    expect(EXPORT_KEYS).toContain('svg')
  })
  test('every row has words to show and every format an extension', () => {
    for (const id of EXPORT_KEYS) expect(labelOf(id)).not.toBe(id)
    expect(extensionFor('md-assets')).toBe('md')
    expect(extensionFor('docx')).toBe('docx')
    expect(new Set(PANDOC_FORMATS.map((one) => one.id)).size).toBe(PANDOC_FORMATS.length)
  })
  test('a file with no path behind it has nothing to export', () => {
    expect(exportKindOf(null)).toBe('none')
    expect(exportKindOf({ exports: 'file', path: null })).toBe('none')
    expect(exportKindOf({ exports: 'file', path: '/s/a.pdf' })).toBe('file')
    expect(offeredBy('file')).toEqual(['copy'])
    expect(offeredBy('canvas')).toEqual(['png', 'svg', 'pdf'])
  })
  test('notes, canvases and pages print and nothing else does', () => {
    for (const kind of ['note', 'canvas', 'pages']) expect(printable(kind)).toBe(true)
    for (const kind of ['web', 'terminal', undefined]) expect(printable(kind)).toBe(false)
  })
})
