import { describe, expect, test } from 'vitest'
import { insideOnly } from './inside'

describe('a path a link may be joined to a space by', () => {
  test('is the path itself, tidied', () => {
    expect(insideOnly('notes/Plan.md')).toBe('notes/Plan.md')
    expect(insideOnly('notes\\Plan.md')).toBe('notes/Plan.md')
    expect(insideOnly('  notes//./Plan.md  ')).toBe('notes/Plan.md')
    expect(insideOnly('/notes/Plan.md')).toBeNull()
  })

  test('never leaves the space', () => {
    for (const said of [
      '../outside.md',
      'notes/../../outside.md',
      'notes/..',
      '..',
      '../',
      'notes\\..\\..\\outside.md',
    ]) {
      expect(insideOnly(said), said).toBeNull()
    }
  })

  test('is never a path of its own', () => {
    for (const said of [
      '/etc/passwd',
      'C:/Windows/System32/drivers/etc/hosts',
      'c:notes.md',
      '//server/share/note.md',
      '\\\\server\\share\\note.md',
    ]) {
      expect(insideOnly(said), said).toBeNull()
    }
  })

  test('holds nothing a file name cannot hold', () => {
    expect(insideOnly(`notes/${String.fromCharCode(0)}.md`)).toBeNull()
    expect(insideOnly('notes/two\nlines.md')).toBeNull()
    expect(insideOnly(`notes/${String.fromCharCode(0x7f)}.md`)).toBeNull()
  })

  test('is never a name Windows keeps for a device', () => {
    expect(insideOnly('NUL')).toBeNull()
    expect(insideOnly('nul.md')).toBeNull()
    expect(insideOnly('notes/COM1.md')).toBeNull()
    expect(insideOnly('aux.markdown')).toBeNull()
    // A name that merely starts with one is a name.
    expect(insideOnly('console.md')).toBe('console.md')
    expect(insideOnly('notes/COM10.md')).toBe('notes/COM10.md')
  })

  test('is nothing at all for nothing at all', () => {
    expect(insideOnly('')).toBeNull()
    expect(insideOnly('   ')).toBeNull()
    expect(insideOnly('.')).toBeNull()
    expect(insideOnly('./')).toBeNull()
  })
})
