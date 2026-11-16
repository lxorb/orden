import { describe, expect, test, vi } from 'vitest'

const found: Record<string, string> = {
  'shot.png': 'assets/shot.png',
  'deep.png': 'notes/pictures/deep.png',
  'pictures/deep.png': 'notes/pictures/deep.png',
  'assets/shot.png': 'assets/shot.png',
  'Pasted image 1.png': 'attachments/Pasted image 1.png',
  'attachments/Pasted image 1.png': 'attachments/Pasted image 1.png',
}

const held = new Set(['/Work/assets/shot.png', '/Work/notes/pictures/deep.png'])

vi.mock('./links.svelte', () => ({
  links: {
    fileFor: (name: string, notePath: string | null) =>
      notePath !== null && found[name] ? `/Work/${found[name]}` : null,
    holdsFile: (path: string) => held.has(path),
  },
}))

const { notePicture } = await import('./note-images')

describe('a picture a note names', () => {
  test('a bare name is looked for anywhere in the space, the way Obsidian looks', () => {
    expect(notePicture('shot.png', '/Work/notes/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('deep.png', '/Work/Q1.md', '')).toBe('/asset/Work/notes/pictures/deep.png')
  })

  test('a path is a path beside the note, index or no index', () => {
    expect(notePicture('assets/shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('../assets/shot.png', '/Work/notes/Q1.md', '')).toBe(
      '/asset/Work/assets/shot.png',
    )
  })

  test('a path nothing beside the note holds is looked for the way a link to it is', () => {
    expect(notePicture('pictures/deep.png', '/Work/journal/Today.md', '')).toBe(
      '/asset/Work/notes/pictures/deep.png',
    )
    expect(notePicture('assets/shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
  })

  test('a name written with escapes, as a markdown link writes it, is looked for as it reads', () => {
    expect(notePicture('Pasted%20image%201.png', '/Work/notes/n.md', '')).toBe(
      '/asset/Work/attachments/Pasted%20image%201.png',
    )
    expect(notePicture('attachments/Pasted%20image%201.png', '/Work/notes/n.md', '')).toBe(
      '/asset/Work/attachments/Pasted%20image%201.png',
    )
  })

  test('a name nothing in the space answers to is still tried beside the note', () => {
    expect(notePicture('nowhere.png', '/Work/Q1.md', '')).toBe('/asset/Work/nowhere.png')
  })

  test('one off the network is left exactly where it points', () => {
    expect(notePicture('https://example.com/pic.png', '/Work/Q1.md', '')).toBe(
      'https://example.com/pic.png',
    )
  })

  test('a note with no home yet has nowhere to resolve from', () => {
    expect(notePicture('assets/shot.png', null, '')).toBe('assets/shot.png')
  })
})
