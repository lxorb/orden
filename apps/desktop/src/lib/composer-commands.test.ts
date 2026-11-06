import type { EditorView } from '@orden/editor'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const reading = {
  state: {
    readOnly: true,
    selection: { main: { empty: true, head: 0 } },
    doc: { sliceString: () => '' },
  },
} as unknown as EditorView

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
  const CHAT = `${SPACE}/Team.chat`

  function withChat() {
    openAt(`${SPACE}/a.md`)
    workspace.notes.push({ path: CHAT, name: 'Team.chat' })
  }

  async function runMerge() {
    composerCommands()
      .find((command) => command.id === 'merge-into')
      ?.run()
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

const typing = {
  state: {
    readOnly: false,
    selection: { main: { empty: false, head: 0, from: 0, to: 4 } },
    doc: { sliceString: () => 'some words' },
  },
} as unknown as EditorView

function offered(id: string, view?: EditorView): boolean {
  return !composerCommands(view).find((command) => command.id === id)?.disabled
}

describe.each(['split-at-caret', 'extract-selection'])('%s', (id) => {
  test('is offered for a note of the open space', () => {
    openAt(`${SPACE}/a.md`)
    expect(offered(id, typing)).toBe(true)
  })

  test('is not offered for a file that is not a markdown note', () => {
    for (const file of ['snippets.json', 'custom.css', 'notes.txt', 'main.rs', 'Board.canvas']) {
      openAt(`${SPACE}/${file}`)
      expect(offered(id, typing)).toBe(false)
    }
  })

  test('is offered for a note of a space that is not the open one, which it carves beside', () => {
    openAt('/other/a.md')
    expect(offered(id, typing)).toBe(true)
  })

  test('is not offered in a space shared to be read', () => {
    readOnly.add(SPACE)
    openAt(`${SPACE}/a.md`)
    expect(offered(id, typing)).toBe(false)
  })
})
