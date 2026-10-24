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
  merged: [] as string[],
  mergeInto(from: string, into: string) {
    this.merged.push(`${from} -> ${into}`)
    return Promise.resolve()
  },
}))

vi.mock('./workspace.svelte', () => ({ workspace }))

/** The prompt sheet, which answers with whatever is put in `answer` and keeps the
 *  ids of the notes it was asked to offer. */
const asked = vi.hoisted(() => ({ offered: [] as string[], answer: null as string | null }))
vi.mock('./prompt.svelte', () => ({
  prompt: {
    find: (question: { options: { id: string }[] }) => {
      asked.offered = question.options.map((option) => option.id)
      return Promise.resolve(asked.answer)
    },
  },
}))

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
  workspace.merged = []
  asked.offered = []
  asked.answer = null
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

describe('the notes offered to merge into', () => {
  /** A chat's pointer is JSON the chat is found by; words appended to it would
   *  leave the chat unreachable, and sync would carry the broken pointer. */
  const CHAT = `${SPACE}/Team.chat`

  function withChat() {
    openAt(`${SPACE}/a.md`)
    workspace.notes.push({ path: CHAT, name: 'Team.chat' })
  }

  async function runMerge() {
    composerCommands()
      .find((command) => command.id === 'merge-into')
      ?.run()
    // The sheet is imported, then asked, then answered.
    await vi.waitFor(() => expect(asked.offered.length).toBeGreaterThan(0))
    await new Promise((settle) => setTimeout(settle, 0))
  }

  test('are the other markdown notes, and never a chat', async () => {
    withChat()
    await runMerge()
    expect(asked.offered).toEqual([`${SPACE}/b.md`])
  })

  test('so merge is not offered when a chat is the only other one', () => {
    openAt(`${SPACE}/a.md`)
    workspace.notes = [
      { path: `${SPACE}/a.md`, name: 'a.md' },
      { path: CHAT, name: 'Team.chat' },
    ]
    expect(mergeOffered()).toBe(false)
  })

  test('and a markdown note picked is merged into', async () => {
    withChat()
    asked.answer = `${SPACE}/b.md`
    await runMerge()
    expect(workspace.merged).toEqual([`${SPACE}/a.md -> ${SPACE}/b.md`])
  })
})
