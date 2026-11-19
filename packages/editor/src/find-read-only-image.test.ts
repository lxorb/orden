// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { findExtensions, findNext, loadFind, NO_FIND, setFind } from './find'
import { livePreview } from './live-preview'
import { ImageWidget } from './live-preview/image'
import { noReveal } from './live-preview/reveal'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await loadFind()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function pictureOver(view: EditorView, from: number, to: number): boolean {
  let covered = false
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? source(view) : source
    set.between(from, to, (start, end, value) => {
      const widget = (value.spec as { widget?: unknown }).widget
      if (widget instanceof ImageWidget && start <= from && end >= to) covered = true
    })
  }
  return covered
}
describe('finding words in a picture description, in Read-only mode', () => {
  test('shows the match instead of leaving it inside the drawn picture', async () => {
    const doc = 'Our setup\n\n![architecture sketch](sketch.png)\n\nend'
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
          EditorState.readOnly.of(true),
          noReveal.of(true),
          findExtensions(),
        ],
      }),
    )
    const view = new EditorView({ state, parent: document.body })
    open.push(view)
    await setFind(view, { ...NO_FIND, query: 'architecture' })
    findNext(view)
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('architecture')
    expect(pictureOver(view, from, to)).toBe(false)
  })
})
