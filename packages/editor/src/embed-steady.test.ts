// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { livePreview } from './live-preview'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { type NoteIndex, noteIndexExtension, setNoteIndex } from './wikilink/notes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const PLAN = { path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }

function space(): NoteIndex {
  return {
    notes: [PLAN],
    files: [],
    path: 'Today.md',
    read: () => new Promise((done) => setTimeout(() => done('the plan words'), 5)),
    locked: () => false,
    render: (source) => Promise.resolve(`<p>${source}</p>`),
  }
}

function viewOf(index: NoteIndex) {
  const doc = 'Top\n\n![[Plan]]\n\nend'
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreview(),
        noteIndexExtension(index),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}

const settle = () => new Promise((done) => setTimeout(done, 30))

describe('a note embed while the note around it is typed in and saved', () => {
  test('keeps showing the embedded words when only the note around it was saved', async () => {
    const view = viewOf(space())
    await settle()
    const shown = () => view.dom.querySelector('.orden-embed-body')?.textContent ?? ''
    expect(shown()).toBe('the plan words')

    view.dispatch({ changes: { from: 3, insert: ' typed' }, selection: EditorSelection.cursor(9) })
    setNoteIndex(view, space())

    expect(shown()).toBe('the plan words')
    expect(view.dom.querySelector('.orden-embed-loading')).toBeNull()
  })
})
