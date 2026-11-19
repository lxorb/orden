import { describe, expect, test, vi } from 'vitest'
import { insideOnly, namesByShortName } from './inside'

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
  test('on Windows, holds no name Windows would open as another, without its last dots or spaces', () => {
    vi.stubGlobal('window', { __TAURI_OS_PLUGIN_INTERNALS__: { platform: 'windows' } })
    try {
      for (const said of ['Diary./secret.md', 'Plans.md.', 'Diary /secret.md', 'Plans.md ..']) {
        expect(insideOnly(said), said).toBeNull()
      }
      expect(insideOnly('Mr. Smith/Plan.md')).toBe('Mr. Smith/Plan.md')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(insideOnly('Diary./secret.md')).toBe('Diary./secret.md')
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
    expect(insideOnly('notes/COM¹.md')).toBeNull()
    expect(insideOnly('CONOUT$.md')).toBeNull()
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
test.each<[unknown, ...Parameters<typeof namesByShortName>]>([
  [true, 'PRIVAT~1/Diary.md'],
  [true, 'THERAP~1.MD'],
  [true, 'Work/priva~12/Diary.md'],
  [false, 'Private Journal/Diary.md'],
  [false, 'Plan ~2.md'],
  [false, 'Notes~ideas.md'],
  [true, 'PRIVAT~1./Diary.md'],
  [true, 'Notes/DIARY~1.MD. .'],
  [true, 'C:\\Users\\me\\Orden\\Work\\PRIVAT~1'],
  [false, 'C:\\Users\\me\\Orden\\Work\\Private'],
])('%j from %j', (expected, ...args) => {
  expect(namesByShortName(...args)).toBe(expected)
})
