import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { turnBlocksInto } from './commands'
import type { BlockShape } from './shape'
import { ordenMarkdownExtensions } from '../markdown/extensions'

const extensions = [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })]

function turned(doc: string, words: string, shape: BlockShape): EditorState {
  const at = doc.indexOf(words) + 1
  let state = parsed(EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions }))
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec | Transaction) => {
      state = parsed(spec instanceof Transaction ? spec.state : state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView
  turnBlocksInto(view, at, shape)
  return state
}

function listedNumbered(state: EditorState, words: string): boolean {
  const text = state.doc.toString()
  const at = text.indexOf(`. ${words}`) + 2
  if (at < 2) return false
  for (let node = syntaxTree(state).resolveInner(at, 1).node; node.parent; node = node.parent) {
    if (node.name === 'OrderedList') return true
  }
  return false
}

const LIST = 'Steps:\n\n1. Preheat\n2. Mix\n3. Bake\n'

describe('Turn into from the block menu on the first item of a numbered list', () => {
  test('Text keeps the items after it a numbered list', () => {
    const state = turned(LIST, 'Preheat', 'paragraph')
    expect(listedNumbered(state, 'Mix')).toBe(true)
    expect(listedNumbered(state, 'Bake')).toBe(true)
  })

  test('Quote keeps the items after it a numbered list outside the quote', () => {
    const state = turned(LIST, 'Preheat', 'quote')
    expect(listedNumbered(state, 'Mix')).toBe(true)
    expect(listedNumbered(state, 'Bake')).toBe(true)
  })
})
