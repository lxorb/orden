// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { landOnLine } from './landing'
import { livePreview } from './live-preview'
import { quietMarks } from './live-preview/reveal'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

describe('landing on a heading from the outline or the palette', () => {
  test('puts the caret after the hidden hashes when quiet marks are on', () => {
    const doc = 'intro\n\n## Plan\n\nwords'
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
          quietMarks.of(true),
        ],
      }),
    )
    const view = new EditorView({ state, parent: document.body })
    open.push(view)

    landOnLine(view, 2)
    view.dispatch(view.state.replaceSelection('x'))

    expect(view.state.doc.line(3).text).toBe('## xPlan')
  })
})
