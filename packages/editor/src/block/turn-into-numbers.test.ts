import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { turnBlocksInto } from './commands'
import type { BlockShape } from './shape'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function turned(doc: string, words: string, shape: BlockShape): string {
  const at = doc.indexOf(words)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = parsed(state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView
  turnBlocksInto(view, at, shape)
  return state.doc.toString()
}

describe('turn into on a heading whose words start with a number', () => {
  test('another heading level keeps the section number', () => {
    expect(turned('## 1. Introduction\n', 'Intro', 'heading1')).toBe('# 1. Introduction\n')
  })

  test('a paragraph keeps the number too', () => {
    expect(turned('## 2024. Review\n', 'Review', 'paragraph')).toContain('2024')
  })
})

describe('turn into on a paragraph whose later line starts with a number and a dot', () => {
  test('a quote keeps the number, which is words of the paragraph', () => {
    expect(turned('We met in\n2024. It went well.\n', 'We met', 'quote')).toBe('> We met in\n> 2024. It went well.\n')
  })
})
