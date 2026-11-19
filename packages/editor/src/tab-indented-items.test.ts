import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { renderMarkdown } from '@orden/markdown'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import { indentItems, outdentItems } from './list-keys'

function pressed(command: StateCommand, doc: string, words: string): EditorState {
  const at = doc.indexOf(words) + 1
  const state = parsed(editorState({ doc, selection: EditorSelection.cursor(at) }))
  let next = state
  command({ state, dispatch: (one: Transaction) => (next = parsed(one.state)) })
  return next
}
function itemsAround(state: EditorState, words: string): number {
  const at = state.doc.toString().indexOf(words)
  let depth = 0
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1); node;) {
    if (node.name === 'ListItem') depth++
    node = node.parent
  }
  return depth
}
const NESTED = '- Trip\n\t- Packing\n\t\t- [ ] passport\n- Home\n'
describe('Shift-Tab on a tab-indented item, as Obsidian writes nested lists', () => {
  test('takes its sub-task out with it, still a task', () => {
    const after = pressed(outdentItems, NESTED, 'Packing').doc.toString()
    expect(renderMarkdown(after)).toContain('<input disabled="" type="checkbox"> passport')
  })
  test('brings the item out of its parent', () => {
    const after = pressed(outdentItems, NESTED, 'Packing').doc.toString()
    expect(renderMarkdown(after)).not.toMatch(/Trip<ul>/)
  })
})
describe('Tab on a tab-indented item', () => {
  test('nests it under the item above in the editor too', () => {
    const doc = '- Trip\n\t- Packing\n\t- Tickets\n'
    expect(itemsAround(pressed(indentItems, doc, 'Tickets'), 'Tickets')).toBe(3)
  })
})
