import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { pointerSnap } from './live-preview/snap'
import { buildDecorations } from './live-preview/decorate'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

const PARK = '\n\nx'

function state(doc: string, cursor: number) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), pointerSnap],
    }),
  )
}

function click(doc: string, pos: number): number {
  const full = doc + PARK
  const before = state(full, full.length)
  return before.update({ selection: EditorSelection.cursor(pos), userEvent: 'select.pointer' }).state.selection.main
    .head
}

function hidden(doc: string): string[] {
  const full = doc + PARK
  const out: string[] = []
  buildDecorations(state(full, full.length)).atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

describe('a click inside words in brackets that are not a link', () => {
  const doc = 'as said [sic] and in [1] too'

  test('the brackets are drawn, not hidden', () => {
    expect(hidden(doc)).toEqual([])
  })

  test('a click just after the opening bracket lands there', () => {
    const at = doc.indexOf('[sic]') + 1
    expect(click(doc, at)).toBe(at)
  })

  test('a click just before the closing bracket lands there', () => {
    const at = doc.indexOf('[1]') + 2
    expect(click(doc, at)).toBe(at)
  })
})

describe('a click inside a bang and brackets with no address', () => {
  const doc = 'wow ![not a picture] ok'

  test('lands where it was pressed', () => {
    expect(hidden(doc)).toEqual([])
    const at = doc.indexOf('not')
    expect(click(doc, at)).toBe(at)
  })
})
