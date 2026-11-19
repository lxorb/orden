// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { findExtensions, findNext, loadFind, NO_FIND, setFind } from './find'
import { blockDecorations } from './live-preview/blocks'
import { livePreview } from './live-preview'
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
function drawnOver(view: EditorView, from: number, to: number): boolean {
  let covered = false
  view.state.field(blockDecorations).decorations.between(from, to, (start, end) => {
    if (start <= from && end >= to) covered = true
  })
  return covered
}
describe('finding a word that sits in a table, in Read-only mode', () => {
  test('shows the match instead of leaving it inside the drawn table', async () => {
    const doc = 'Fruit list\n\n| name | price |\n| --- | --- |\n| apple | 3 |\n\nend'
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
    await setFind(view, { ...NO_FIND, query: 'apple' })
    findNext(view)
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('apple')
    expect(drawnOver(view, from, to)).toBe(false)
  })
})
