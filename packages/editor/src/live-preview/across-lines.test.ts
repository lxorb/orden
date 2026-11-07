// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { trustedMarkup } from '../markup'
import { livePreview } from '.'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, trusted = false): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        trustedMarkup(trusted),
        livePreview(),
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  return view
}

const ACROSS = [
  '%%\nmulti\nline\n%%',
  '<!--\nmulti\nline\n-->',
  'a <!-- c\nd --> b',
  'a %%c\nd%% b',
  '<img\n  src="a.png">',
  '<iframe\nsrc="https://example.com">',
  '![a\nb](a.png)',
]

test.each(ACROSS)('opens and types into %j', (sample) => {
  for (const trusted of [false, true]) {
    const doc = `# Opened\n\n${sample}\n\nbody`
    const view = viewOf(doc, trusted)
    view.dispatch({ changes: { from: doc.length, insert: 'TYPED' } })
    expect(view.state.doc.toString()).toBe(`${doc}TYPED`)
    expect(view.contentDOM.textContent).toContain('bodyTYPED')
  }
})

test('a note swapped in for another is the one drawn', () => {
  const view = viewOf('# Before\n\nold words')
  const next = '# Opened\n\n%%\nmulti\nline\n%%\n\nYour notes'
  view.setState(
    EditorState.create({
      doc: next,
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreview(),
      ],
    }),
  )
  expect(view.contentDOM.textContent).toContain('Your notes')
  expect(view.contentDOM.textContent).not.toContain('old words')
})

test('Enter inside a one-line comment, then leaving it, is not a crash', () => {
  const doc = 'a %% note %% b\n\nend'
  const view = viewOf(doc)
  const inside = doc.indexOf('note') + 2
  view.dispatch({ selection: { anchor: inside } })
  view.dispatch({ changes: { from: inside, insert: '\n' }, selection: { anchor: inside + 1 } })
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
  expect(view.state.doc.toString()).toBe('a %% no\nte %% b\n\nend!')
  expect(view.contentDOM.textContent).toContain('end!')
})
