import { describe, expect, test } from 'vitest'
import { noteLinks } from './note-links'
import { type LinkWrite, type NoteIndex, type NoteRef, resolveFile, resolveNote } from './notes'

function note(path: string): NoteRef {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
  return { path, name, headings: [], blocks: [], aliases: [] }
}

const index: NoteIndex = {
  notes: [note('Plan.md'), note('work/Plan.md'), note('Ideas.md')],
  files: ['paper.pdf', 'pics/cat.png', 'Board.canvas'],
  path: 'journal/Today.md',
  read: () => Promise.resolve(null),
}

const wikilink = (target: LinkWrite) => `[[${target.name}]]`
const markdown = (target: LinkWrite) =>
  `[${target.name}](${target.path ?? ''} from ${target.from ?? ''})`

describe('noteLinks', () => {
  test.each([
    [index, '[[Ideas]]', ['Ideas.md'], wikilink],
    [index, '[[work/Plan]]', ['work/Plan.md'], wikilink],
    [index, '[[Ideas]]\n[[paper.pdf]]', ['Ideas.md', 'paper.pdf'], wikilink],
    [index, '![[cat.png]]', ['pics/cat.png'], wikilink],
    [index, '[[Board.canvas]]', ['Board.canvas'], wikilink],
    [index, '[[Trips]]', ['Trips/Trips.md'], wikilink],
    [index, '[Ideas](Ideas.md from journal/Today.md)', ['Ideas.md'], markdown],
  ])('%j', (input, wanted, extra, last) => expect(noteLinks(input, extra, last)).toEqual(wanted))

  test('a file whose name another file shares is linked by its path', () => {
    const twins = { ...index, files: ['image.png', 'Trips/image.png'] }
    expect(noteLinks(twins, ['Trips/image.png'], wikilink)).toBe('![[Trips/image.png]]')
    expect(noteLinks(index, ['pics/cat.png'], wikilink)).toBe('![[cat.png]]')
  })

  test('a note or file at the top whose name one beside the note shares is linked from the top', () => {
    const asked: NoteIndex = {
      notes: [note('Plan.md'), note('Work/Plan.md'), note('Work/Journal.md')],
      files: ['image.png', 'Work/image.png'],
      path: 'Work/Journal.md',
      read: () => Promise.resolve(null),
    }
    const top = noteLinks(asked, ['Plan.md'], wikilink)
    expect(top).toBe('[[/Plan]]')
    expect(resolveNote(asked, '/Plan')?.path).toBe('Plan.md')
    expect(noteLinks(asked, ['image.png'], wikilink)).toBe('![[/image.png]]')
    expect(resolveFile(asked, '/image.png', 'wikilink')).toBe('image.png')
  })

  test('a markdown link is given a path that reaches the same file read from the note first', () => {
    const shortest = (target: LinkWrite) => target.markdown ?? ''
    const here = { ...index, files: ['image.png', 'a/b/image.png'], path: 'a/b/c.md' }
    expect(noteLinks(here, ['image.png'], shortest)).toBe('!/image.png')
    expect(noteLinks(here, ['a/b/image.png'], shortest)).toBe('!image.png')

    const three = [note('c.md'), note('a/b/c.md'), note('b/c.md')]
    const notes = { ...index, notes: three, path: 'a/new.md' }
    expect(noteLinks(notes, ['b/c.md'], shortest)).toBe('/b/c.md')
    expect(noteLinks(notes, ['a/b/c.md'], shortest)).toBe('b/c.md')
    expect(noteLinks(notes, ['c.md'], shortest)).toBe('c.md')
  })

  test('a file two folders share a name in is linked by enough of the path to reach it', () => {
    const files = { ...index, files: ['a/pic.png', 'a/b/pic.png', 'b/pic.png', 'c/d.png'] }
    expect(noteLinks(files, ['a/b/pic.png'], wikilink)).toBe('![[a/b/pic.png]]')
    expect(noteLinks(files, ['b/pic.png'], wikilink)).toBe('![[b/pic.png]]')
    expect(noteLinks(files, ['c/d.png'], wikilink)).toBe('![[d.png]]')
  })
})
