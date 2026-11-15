import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { toggleWrap } from './commands'
import { toggleHighlight } from './highlight'
import { highlightAcross, marksAcross } from './marks'
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
    expect(ran(highlightAcross(highlightTone(null)), '> [!NOTE] Title\n> body')).not.toContain(
      '==[!NOTE]',
    )
  })
})
