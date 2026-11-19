// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldable, foldEffect } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { folding, withFolds } from './fold'
import { livePreview } from './live-preview'
import { loadTaskChips } from './live-preview/decorate'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await loadTaskChips()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string) {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), folding(), livePreview()],
    }),
  )
  state = withFolds(state, [])
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}
describe('a folded block with words drawn on its first line', () => {
  test('a callout written folded shows its label once', () => {
    const doc = 'intro\n\n> [!tip]- Read me\n> hidden words\n> more words\n\nafter'
    const view = viewOf(doc)
    expect(view.dom.querySelectorAll('.orden-folded')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.orden-callout-label')).toHaveLength(1)
  })
  test('a folded item with a who chip shows the chip once', () => {
    const doc = 'intro\n\n- call the shop [by:: Ann]\n  - ask about hours\n  - ask about price\n\nafter'
    const view = viewOf(doc)
    const head = view.state.doc.line(3)
    const range = foldable(view.state, head.from, head.to)
    expect(range).not.toBeNull()
    if (range) view.dispatch({ effects: foldEffect.of(range) })
    expect(view.dom.querySelectorAll('.orden-folded')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.orden-comment-chips')).toHaveLength(1)
  })
})
describe('a folded code block', () => {
  test('shows its header once', () => {
    const doc = 'intro\n\n```js\nconst a = 1\nconst b = 2\n```\n\nafter'
    const view = viewOf(doc)
    const head = view.state.doc.line(3)
    const range = foldable(view.state, head.from, head.to)
    expect(range).not.toBeNull()
    if (range) view.dispatch({ effects: foldEffect.of(range) })
    expect(view.dom.querySelectorAll('.orden-folded')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.orden-fence-header')).toHaveLength(1)
  })
})
