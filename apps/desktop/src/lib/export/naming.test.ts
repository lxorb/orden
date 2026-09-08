import { describe, expect, test } from 'vitest'
import { EXPORT_FORMATS, EXPORT_VARIANTS, extensionFor, TEXTPACK } from './formats'
import { claimName, fileNameFor, freeName, stemOf } from './naming'

describe('what an exported file is called', () => {
  test('is the note’s name with the format’s extension', () => {
    expect(fileNameFor('Export corpus.md', 'docx')).toBe('Export corpus.docx')
    expect(fileNameFor('Notes.markdown', 'epub')).toBe('Notes.epub')
  })

  test('a note with no extension simply gains one', () => {
    expect(fileNameFor('Untitled', 'txt')).toBe('Untitled.txt')
  })

  test('a dot inside the name is not an extension', () => {
    expect(stemOf('Version 1.2 notes.md')).toBe('Version 1.2 notes')
    expect(fileNameFor('Version 1.2 notes.md', 'rtf')).toBe('Version 1.2 notes.rtf')
  })

  test('only the last extension goes', () => {
    expect(fileNameFor('archive.tar.md', 'txt')).toBe('archive.tar.txt')
  })

  test('a path is left alone, because only a name is ever passed in', () => {
    expect(stemOf('folder/Note.md')).toBe('folder/Note')
  })
})

describe('a name that is already taken', () => {
  test('gets a number before the extension, the way the app names a copy', () => {
    expect(freeName('Note.docx', new Set(['Note.docx']))).toBe('Note 2.docx')
  })

  test('counts on until it finds a gap', () => {
    const taken = new Set(['Note.docx', 'Note 2.docx', 'Note 3.docx'])
    expect(freeName('Note.docx', taken)).toBe('Note 4.docx')
  })

  test('takes a gap in the middle rather than the end', () => {
    expect(freeName('Note.docx', new Set(['Note.docx', 'Note 3.docx']))).toBe('Note 2.docx')
  })

  test('is left alone when nothing has it', () => {
    expect(freeName('Note.docx', new Set(['Other.docx']))).toBe('Note.docx')
  })

  test('a name with no extension takes the number at the end', () => {
    expect(freeName('Exports', new Set(['Exports']))).toBe('Exports 2')
  })

  test('a dotfile is a name, not an extension', () => {
    expect(freeName('.keep', new Set(['.keep']))).toBe('.keep 2')
  })
})

describe('claiming a name', () => {
  test('tells the set about the name it gave out', () => {
    const taken = new Set<string>()

    expect(claimName('pic.png', taken)).toBe('pic.png')
    expect(claimName('pic.png', taken)).toBe('pic 2.png')
    expect(claimName('pic.png', taken)).toBe('pic 3.png')
    expect([...taken].sort()).toEqual(['pic 2.png', 'pic 3.png', 'pic.png'])
  })
})

describe('the export list', () => {
  test('is the nine formats Typora offers, plus PNG beside JPG', () => {
    expect(EXPORT_FORMATS.map((one) => one.id)).toEqual([
      'txt',
      'md',
      'textbundle',
      'rtf',
      'pdf',
      'jpg',
      'png',
      'html',
      'docx',
      'epub',
    ])
  })

  test('names the extension every one of them writes', () => {
    for (const format of EXPORT_FORMATS) {
      expect(extensionFor(format.id), format.id).toBe(format.extension)
      expect(format.extension, format.id).toMatch(/^[a-z]+$/)
    }
  })

  test('gives every variant an extension too', () => {
    for (const variant of EXPORT_VARIANTS) {
      expect(extensionFor(variant.id), variant.id).toBe(variant.extension)
    }
  })

  test('has an id nothing else has, across the formats and the variants', () => {
    const ids = [...EXPORT_FORMATS, ...EXPORT_VARIANTS].map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('labels each row with something a person reads', () => {
    for (const one of [...EXPORT_FORMATS, ...EXPORT_VARIANTS]) {
      expect(one.label.trim(), one.id).not.toBe('')
    }
  })

  test('zips a TextBundle where a folder cannot be handed over', () => {
    expect(TEXTPACK).toBe('textpack')
    expect(extensionFor('textbundle')).toBe('textbundle')
  })
})
