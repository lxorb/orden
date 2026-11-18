// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'
import { quietMarks } from './reveal'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, cursor: number, quiet: boolean) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreview(),
        quietMarks.of(quiet),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}

describe('a table of contents entry, with quiet marks on', () => {
  test('puts the caret where the heading words start, after the hidden #', () => {
    const doc = '[toc]\n\nintro\n\n## Plan\n\nwords\n'
    const view = viewOf(doc, doc.indexOf('intro'), true)
    const entry = view.dom.querySelector('.orden-toc a')
    expect(entry).not.toBeNull()
    entry?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(5).text).toBe('## xPlan')
  })
})
