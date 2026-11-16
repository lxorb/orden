import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { blockDecorations } from './live-preview/blocks'
import { dragFreeze } from './live-preview/dragging'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { remoteCarets, setPeers } from './carets'
import { external } from './external'

const DOC = 'Intro\n\n$$\nx = 1\n$$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nend'

function editingInside(source: string) {
  const start = parsed(
    EditorState.create({
      doc: DOC,
      selection: EditorSelection.cursor(DOC.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
        remoteCarets(),
      ],
    }),
  )
  const at = DOC.indexOf(source)
  return start.update({ selection: EditorSelection.cursor(at), userEvent: 'select' }).state
}

function drawn(state: EditorState): string[] {
  const out: string[] = []
  state.field(blockDecorations).decorations.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

const peer = { id: 2, name: 'Ana', colour: '#c33', head: 1, anchor: 1 }

describe('a block whose source the caret is in, when a room partner moves their caret', () => {
  test('a maths block stays open as source', () => {
    const editing = editingInside('x = 1')
    expect(drawn(editing)).not.toContain('$$\nx = 1\n$$')

    const moved = editing.update({
      effects: setPeers.of([peer]),
      annotations: external.of(true),
    }).state

    expect(drawn(moved)).not.toContain('$$\nx = 1\n$$')
  })

  test('a table stays open as source', () => {
    const editing = editingInside('| 1 |')
    expect(drawn(editing)).toEqual(['$$\nx = 1\n$$'])

    const moved = editing.update({
      effects: setPeers.of([peer]),
      annotations: external.of(true),
    }).state

    expect(drawn(moved)).toEqual(['$$\nx = 1\n$$'])
  })

  test('a maths block stays open as source when a partner types further down the note', () => {
    const editing = editingInside('x = 1')
    const typed = editing.update({
      changes: { from: DOC.length, insert: ' more' },
      annotations: external.of(true),
      filter: false,
    }).state

    expect(drawn(typed)).not.toContain('$$\nx = 1\n$$')
  })
})
