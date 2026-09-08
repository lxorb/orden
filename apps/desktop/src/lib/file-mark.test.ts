import { describe, expect, test } from 'vitest'
import { fileMark } from './file-mark'

describe('the mark a file wears', () => {
  test('a note is a note by its extension, whichever one is written', () => {
    expect(fileMark('Read me.md')).toBe('note')
    expect(fileMark('Plan.markdown')).toBe('note')
    expect(fileMark('Notes.mdown')).toBe('note')
    expect(fileMark('Old.mkd')).toBe('note')
  })

  test('a canvas, a paper and a picture each have their own', () => {
    expect(fileMark('Board.canvas')).toBe('canvas')
    expect(fileMark('Deep Learning.pdf')).toBe('pdf')
    expect(fileMark('shot.png')).toBe('picture')
  })

  test('every extension a picture is written in', () => {
    for (const name of [
      'a.png',
      'a.apng',
      'a.jpg',
      'a.jpeg',
      'a.gif',
      'a.webp',
      'a.avif',
      'a.bmp',
      'a.ico',
      'a.svg',
    ]) {
      expect(fileMark(name), name).toBe('picture')
    }
  })

  test('and anything else is a plain file', () => {
    expect(fileMark('notes.txt')).toBe('file')
    expect(fileMark('data.json')).toBe('file')
    expect(fileMark('archive.zip')).toBe('file')
  })

  test('a name with no extension is a file rather than a note', () => {
    expect(fileMark('Makefile')).toBe('file')
    expect(fileMark('')).toBe('file')
  })

  test('a dotfile is read by what follows its last dot', () => {
    expect(fileMark('.gitignore')).toBe('file')
    expect(fileMark('.keep')).toBe('file')
    // Nothing but an extension is still that extension.
    expect(fileMark('.md')).toBe('note')
  })

  test('the case of the extension makes no difference', () => {
    expect(fileMark('SHOUTING.MD')).toBe('note')
    expect(fileMark('Paper.PDF')).toBe('pdf')
    expect(fileMark('Board.CANVAS')).toBe('canvas')
    expect(fileMark('Shot.PNG')).toBe('picture')
  })

  test('only the last dot decides', () => {
    expect(fileMark('Notes v1.2.md')).toBe('note')
    expect(fileMark('backup.md.bak')).toBe('file')
    expect(fileMark('paper.pdf.md')).toBe('note')
    expect(fileMark('shot.png.canvas')).toBe('canvas')
  })

  test('a name that is only an extension-looking word is a file', () => {
    expect(fileMark('md')).toBe('file')
    expect(fileMark('pdf')).toBe('file')
    expect(fileMark('canvas')).toBe('file')
  })
})
