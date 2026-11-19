import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'
import { parseWikilink, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { continueLists } from './commands'
import { editorState } from './editor'
import { indentItems } from './list-keys'

function tabbedOn(doc: string, words: string): EditorState {
  const at = doc.indexOf(words) + 1
  const state = parsed(editorState({ doc, selection: EditorSelection.cursor(at) }))
  let next = state
  indentItems({ state, dispatch: (one: Transaction) => (next = parsed(one.state)) })
  return next
}

function typedAfterEnter(doc: string, words: string): string {
  const state = parsed(editorState({ doc, selection: EditorSelection.cursor(doc.length) }))
  let next = state
  continueLists({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.update({ changes: { from: next.selection.main.head, insert: words } }).state.doc.toString()
}

function embedded(text: string, id: string): string | null {
  const link = parseWikilink(`#^${id}`)
  return link && sectionOf(text, link)
}

describe('Tab on a new item under a list nested with tabs, as Obsidian writes it', () => {
  test('the sub-item above, embedded by its id, does not take the new item in', () => {
    const doc = '- Trip\n\t- Packing ^pack\n- Tickets\n'
    const after = tabbedOn(doc, 'Tickets').doc.toString()
    expect(embedded(after, 'pack')).toBe('- Packing')
  })

  test('a numbered sub-item above, embedded by its id, does not take the new item in', () => {
    const doc = '1. Trip\n2. Plan\n\t1. Book ^book\n3. Pack\n'
    const after = tabbedOn(doc, 'Pack\n').doc.toString()
    expect(embedded(after, 'book')).toBe('1. Book')
  })
})

describe('Enter at the end of a sub-item nested with a tab', () => {
  test('the sub-item, embedded by its id, does not take in the item typed after it', () => {
    const after = typedAfterEnter('- Trip\n\t- Packing ^pack', 'Tickets')
    expect(embedded(after, 'pack')).toBe('- Packing')
  })
})
