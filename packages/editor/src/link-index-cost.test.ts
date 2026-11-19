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

let read = 0

const notes: NoteRef[] = Array.from({ length: 3000 }, (_, at) => {
  const path = `Projects/Area ${at % 40}/Meeting ${at}.md`
  const name = `Meeting ${at}`
  return {
    get path() {
      read++
      return path
    },
    get name() {
      read++
      return name
    },
    headings: [],
    blocks: [],
    aliases: [],
  }
})

const doc = Array.from({ length: 30 }, (_, at) => `- Follow up from [[Meeting ${at * 11}]] with the team.`).join('\n')

function typed(view: EditorView, keys: number): number {
  read = 0
  for (let key = 0; key < keys; key++) view.dispatch(view.state.replaceSelection('x'))
  return read
}

describe('typing in a note full of links, in a space of a few thousand notes', () => {
  test('looks over no note again a key', () => {
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
    typed(view, 3)
    const links = view.dom.querySelectorAll('.orden-link[data-note]').length
    expect(links).toBeGreaterThanOrEqual(15)
    expect(typed(view, 5)).toBeLessThan(notes.length)
  })
})
