import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { toggleWrap } from './commands'
import { toggleHighlight } from './highlight'
import { clearFormatting, highlightAcross, marksAcross } from './marks'
import { highlightTone } from '@orden/markdown/highlights'

function ran(command: StateCommand, doc: string, from = 0, to = doc.length) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  let next = state
  command({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}
describe('edit14 marks over a callout', () => {
  test('bold over a picked callout title line leaves the callout marker outside the run', () => {
    expect(ran(toggleWrap('**'), '> [!NOTE] Title')).toBe('> [!NOTE] **Title**')
  })
  test('bold over a whole callout leaves the callout marker outside the runs', () => {
    expect(ran(marksAcross('**'), '> [!TIP] Title\n> body')).not.toContain('**[!TIP]')
  })
  test('a highlight over a picked callout title line keeps it a callout', () => {
    expect(ran(toggleHighlight(highlightTone(null)), '> [!NOTE] Title')).toBe('> [!NOTE] ==Title==')
  })
  test('a highlight over a whole callout keeps it a callout', () => {
    expect(ran(highlightAcross(highlightTone(null)), '> [!NOTE] Title\n> body')).not.toContain('==[!NOTE]')
  })
})
describe('clear formatting over a selection that starts or ends inside a run', () => {
  const cleared = (doc: string, picked: string) => {
    const from = doc.indexOf(picked)
    return ran(clearFormatting, doc, from, from + picked.length)
  }
  test('a run the selection leaves by its end is closed where the selection starts', () => {
    expect(cleared('This is **very important** text, really.', 'important** text')).toBe(
      'This is **very** important text, really.',
    )
  })
  test('a run the selection enters by its start is opened again where the selection ends', () => {
    expect(cleared('Keep this and *that one* there.', 'this and *that')).toBe('Keep this and that *one* there.')
  })
})
