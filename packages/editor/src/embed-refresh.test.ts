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
function spaceWith(words: string, locked = false): NoteIndex {
  return {
    notes: [PLAN],
    files: [],
    path: 'Today.md',
    read: () => Promise.resolve(words),
    locked: () => locked,
    render: (source) => Promise.resolve(`<p>${source}</p>`),
  }
}
function viewOf(index: NoteIndex) {
  const doc = 'Top\n\n![[Plan]]\n\nend'
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
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
const settle = () => new Promise((done) => setTimeout(done, 20))
function embedText(view: EditorView): string {
  return view.dom.querySelector('.orden-embed-body')?.textContent ?? ''
}
describe('a note embed after the embedded note changes', () => {
  test('shows the embedded note as it is now', async () => {
    const view = viewOf(spaceWith('first words'))
    await settle()
    expect(embedText(view)).toBe('first words')
    setNoteIndex(view, spaceWith('second words'))
    await settle()
    expect(embedText(view)).toBe('second words')
  })
  test('stops showing the words once the embedded note is locked', async () => {
    const view = viewOf(spaceWith('the secret words'))
    await settle()
    expect(embedText(view)).toBe('the secret words')
    setNoteIndex(view, spaceWith('the secret words', true))
    await settle()
    expect(embedText(view)).not.toContain('secret')
  })
})
