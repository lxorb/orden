// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import type { NoteRef } from './wikilink/notes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const notes: NoteRef[] = Array.from({ length: 3000 }, (_, at) => ({
  path: `Projects/Area ${at % 40}/Meeting ${at}.md`,
  name: `Meeting ${at}`,
  headings: [],
  blocks: [],
  aliases: [],
}))

const doc = Array.from(
  { length: 30 },
  (_, at) => `- Follow up from [[Meeting ${at * 11}]] with the team.`,
).join('\n')

function slowest(view: EditorView, keys: number): number {
  let most = 0
  for (let key = 0; key < keys; key++) {
    const start = performance.now()
    view.dispatch(view.state.replaceSelection('x'))
    most = Math.max(most, performance.now() - start)
  }
  return most
}

describe('typing in a note full of links, in a space of a few thousand notes', () => {
  test('takes well under a frame a key', () => {
    const view = new EditorView({
      state: parsed(
        editorState({
          doc,
          selection: { anchor: doc.length },
          notes: { notes, files: [], path: 'Projects/Plan.md', read: () => Promise.resolve(null) },
        }),
      ),
      parent: document.body,
    })
    open.push(view)
    slowest(view, 3)
    const links = view.dom.querySelectorAll('.orden-link[data-note]').length
    expect(links).toBeGreaterThanOrEqual(15)
    expect(slowest(view, 5)).toBeLessThan(16)
  })
})
