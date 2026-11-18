import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { pointerSnap } from './snap'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const PARK = '\n\nx'

function click(doc: string, pos: number): number {
  const full = doc + PARK
  const before = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        pointerSnap,
      ],
    }),
  )
  return before.update({ selection: EditorSelection.cursor(pos), userEvent: 'select.pointer' })
    .state.selection.main.head
}

describe('a click at the edge of a note link', () => {
  test('at the right edge lands after the hidden closing brackets', () => {
    const doc = 'see [[Note]] now'
    expect(click(doc, doc.indexOf(']]'))).toBe(doc.indexOf(']]') + 2)
  })

  test('at the left edge lands before the hidden opening brackets', () => {
    const doc = 'see [[Note]] now'
    expect(click(doc, doc.indexOf('Note'))).toBe(doc.indexOf('[['))
  })

  test('after the words of a renamed link lands after the link', () => {
    const doc = 'see [[Note|the plan]] now'
    expect(click(doc, doc.indexOf(']]'))).toBe(doc.indexOf(']]') + 2)
  })
})
