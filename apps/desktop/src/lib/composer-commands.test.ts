import type { EditorView } from '@nib/editor'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** When the palette offers to merge the note in front of the reader into another.
 *
 *  Split and extract are offered only where they could be carried out; merge writes
 *  one note and deletes another, so it asks the same: that the note may be written,
 *  and that it is one of the open space's, since the notes it offers to merge into
 *  are the open space's. The workspace and the account are stood in for by hand. */

const readOnly = new Set<string>()
const writable = (path: string) => ![...readOnly].some((root) => path.startsWith(`${root}/`))

vi.mock('./sharing.svelte', () => ({
  canWriteAt: writable,
  canWriteIn: (note: { path: string | null } | null) => !note?.path || writable(note.path),
}))

vi.mock('./i18n.svelte', () => ({ t: (words: string) => words }))

const workspace = vi.hoisted(() => ({
  activeSpace: null as { id: string; name: string; root: string } | null,
  active: null as { path: string | null; note: { path: string | null; shared: null } } | null,
  notes: [] as { path: string; name: string }[],
}))

vi.mock('./workspace.svelte', () => ({ workspace }))

const { composerCommands } = await import('./composer-commands')

const SPACE = '/space'

/** An editor that will not be typed in, as a pane in reading mode is; as much of
 *  one as the commands read. */
const reading = {
  state: {
    readOnly: true,
    selection: { main: { empty: true, head: 0 } },
    doc: { sliceString: () => '' },
  },
} as unknown as EditorView

/** The note at `path` open, in the open space holding a and b. */
function openAt(path: string) {
  workspace.activeSpace = { id: 's1', name: 'space', root: SPACE }
  workspace.active = { path, note: { path, shared: null } }
  workspace.notes = [
    { path: `${SPACE}/a.md`, name: 'a.md' },
    { path: `${SPACE}/b.md`, name: 'b.md' },
  ]
}

function mergeOffered(view?: EditorView): boolean {
  const merge = composerCommands(view).find((command) => command.id === 'merge-into')
  return !merge?.disabled
}

beforeEach(() => {
  readOnly.clear()
})

describe('merge into another note', () => {
  test('is offered for a note of the open space', () => {
    openAt(`${SPACE}/a.md`)
    expect(mergeOffered()).toBe(true)
  })

  test('is not offered in a space shared to be read', () => {
    readOnly.add(SPACE)
    openAt(`${SPACE}/a.md`)
    expect(mergeOffered()).toBe(false)
  })

  test('is not offered in an editor that will not be typed in', () => {
    openAt(`${SPACE}/a.md`)
    expect(mergeOffered(reading)).toBe(false)
  })

  test('is not offered for a note of a space that is not the open one', () => {
    openAt('/other/a.md')
    expect(mergeOffered()).toBe(false)
  })

  test('is not offered for a page note, whose paper merging would delete', () => {
    // A page note is JSON beside the PDF it annotates, and deleting it takes the
    // PDF with it: a merge is for notes of words only.
    openAt(`${SPACE}/Lecture.pages`)
    expect(mergeOffered()).toBe(false)
  })

  test('is not offered for a canvas, a web tab or a base', () => {
    for (const file of ['Board.canvas', 'Site.url', 'Books.base']) {
      openAt(`${SPACE}/${file}`)
      expect(mergeOffered()).toBe(false)
    }
  })
})
