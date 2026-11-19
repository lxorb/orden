import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { headingsOf } from '@orden/markdown/links'
import { buildDecorations } from './live-preview/decorate'
import { headings } from './live-preview/toc'
import { trustedMarkup } from './markup'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

const PERCENT = '# Plans\n\n%%\n# Old plan\n\nold words\n%%\n\n# Later\n\nCall the bank\n\nx'
const HTML = '# Plans\n\n<!--\n# Old plan\n\nold words\n-->\n\n# Later\n\nCall the bank\n\nx'
function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), trustedMarkup(false)],
    }),
  )
}
function headingLines(doc: string): string[] {
  const state = stateOf(doc)
  const found: string[] = []
  buildDecorations(state).decorations.between(0, doc.length, (from, _to, value) => {
    const named = (value.spec as { class?: string }).class ?? ''
    if (/\borden-h\d\b/.test(named)) found.push(state.doc.lineAt(from).text)
  })
  return found
}
describe('a section commented out with %% lines around a heading and a paragraph', () => {
  test('the reading view and heading links leave the commented heading out', () => {
    expect(renderMarkdown(PERCENT)).not.toContain('Old plan')
    expect(headingsOf(PERCENT)).toEqual(['Plans', 'Later'])
  })
  test('the contents widget lists only the headings the reading view shows', () => {
    expect(headings(stateOf(PERCENT)).map((one) => one.text)).toEqual(['Plans', 'Later'])
  })
  test('the commented heading is not drawn as a heading, as with an HTML comment', () => {
    expect(headingLines(HTML)).toEqual(['# Plans', '# Later'])
    expect(headingLines(PERCENT)).toEqual(['# Plans', '# Later'])
  })
})
