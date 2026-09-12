/** Where a picture a note names ends up, through the one rule both faces of a note
 *  use. Driven as a page in a browser, because that is the build where the address
 *  is something this repository decides rather than something Tauri hands out. */

import { describe, expect, test, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }))

/** The space, and the one file in it the index can find by name. */
const found: Record<string, string> = {
  'shot.png': 'assets/shot.png',
  'deep.png': 'notes/pictures/deep.png',
}

vi.mock('./workspace.svelte', () => ({ workspace: { activeSpace: { root: '/Work' } } }))
vi.mock('./link-index.svelte', () => ({
  links: { fileNamed: (name: string) => found[name] ?? null },
}))

const { notePicture } = await import('./note-images')

describe('a picture a note names', () => {
  test('a bare name is looked for anywhere in the space, the way Obsidian looks', () => {
    // `![[shot.png]]` from a note one folder down. The index answers with a path
    // from the space's root, and that is the path: joined onto the note's own
    // folder a second time, as it was, this named nowhere and nothing drew.
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
