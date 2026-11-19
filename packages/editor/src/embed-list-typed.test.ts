import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { blockDecorations, buildBlockDecorations } from './live-preview/blocks'
import { dragFreeze } from './live-preview/dragging'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function drawn(set: DecorationSet, doc: string): string[] {
  const out: string[] = []
  set.between(0, doc.length, (from, to) => {
    out.push(doc.slice(from, to))
  })
  return out
}
function typed(doc: string, at: number, words: string): EditorState {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
      ],
    }),
  )
  let pos = at
  for (const character of words) {
    state = parsed(
      state.update({
        changes: { from: pos, insert: character },
        selection: EditorSelection.cursor(pos + 1),
        userEvent: 'input.type',
      }).state,
    )
    pos++
  }
  return state
}
describe('a list typed on the line right under a note embed', () => {
  test('draws the embed again once the item has words, as opening the note draws it', () => {
    const doc = '## Standup\n![[Agenda]]\n\n\nend'
    const state = typed(doc, doc.indexOf('\n\n\nend') + 1, '- first point')
    const now = state.doc.toString()
    expect(drawn(buildBlockDecorations(state), now)).toEqual(['![[Agenda]]'])
    expect(drawn(state.field(blockDecorations).decorations, now)).toEqual(['![[Agenda]]'])
  })
  test('the same for a numbered list', () => {
    const doc = '![[Agenda]]\n\n\nend'
    const state = typed(doc, doc.indexOf('\n\n\nend') + 1, '1. first point')
    const now = state.doc.toString()
    expect(drawn(buildBlockDecorations(state), now)).toEqual(['![[Agenda]]'])
    expect(drawn(state.field(blockDecorations).decorations, now)).toEqual(['![[Agenda]]'])
  })
})
