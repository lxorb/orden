import { describe, expect, test } from 'vitest'
import { PANDOC_FORMATS } from '../export-formats'
import { type ExportKind, offeredBy } from './offer'
import { commandFor, SETUP, shelved } from './tiles'

const KINDS: ExportKind[] = ['note', 'canvas', 'pages', 'file']

const choicesFor = (kind: ExportKind, pandoc: boolean) => [
  ...offeredBy(kind).map((id) => ({ id: `export-${id}`, label: id, run: () => undefined })),
  ...(kind === 'note' ? [{ id: SETUP, label: SETUP, run: () => undefined }] : []),
  ...(pandoc && kind === 'note'
    ? PANDOC_FORMATS.map((one) => ({ id: `export-${one.id}`, label: one.id, run: () => undefined }))
    : []),
]

describe('the export picker', () => {
  test('reaches every format and variant an open tab offers, through a tile or its option', () => {
    for (const kind of KINDS) {
      for (const pandoc of [false, true]) {
        const choices = choicesFor(kind, pandoc)
        const reached = new Set(
          shelved(choices).flatMap((shelf) =>
            shelf.tiles.flatMap((tile) => [commandFor(tile, false), commandFor(tile, true)]),
          ),
        )
        const wanted = choices.map((one) => one.id).filter((id) => id !== SETUP)
        expect([...reached].sort(), `${kind}${pandoc ? ' with pandoc' : ''}`).toEqual(
          [...wanted].sort(),
        )
      }
    }
  })

  test('shelves a note’s formats as documents, text, web and pictures, each with an icon', () => {
    const shelves = shelved(choicesFor('note', false))
    expect(shelves.map((one) => [one.id, one.tiles.map((tile) => tile.id)])).toEqual([
      ['documents', ['pdf', 'docx', 'rtf', 'epub']],
      ['text', ['md', 'txt', 'textbundle']],
      ['web', ['html']],
      ['pictures', ['png', 'jpg']],
    ])
    for (const tile of shelves.flatMap((one) => one.tiles))
      expect(tile.icon.length).toBeGreaterThan(0)
  })

  test('folds the variants into options of their format', () => {
    const tiles = shelved(choicesFor('note', false)).flatMap((one) => one.tiles)
    expect(tiles.map((one) => one.id)).not.toContain('md-assets')
    expect(tiles.map((one) => one.id)).not.toContain('html-bare')
    expect(tiles.find((one) => one.id === 'md')?.option?.command).toBe('export-md-assets')
    expect(tiles.find((one) => one.id === 'html')?.option?.command).toBe('export-html-bare')
  })

  test('shows the format used last first', () => {
    const [first] = shelved(choicesFor('note', false), 'png')
    expect(first?.id).toBe('pictures')
    expect(first?.tiles[0]?.id).toBe('png')
  })
})
