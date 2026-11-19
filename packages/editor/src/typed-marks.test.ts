import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { completionExtensions, loadCompletion } from './completion'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { modeExtensions } from './modes'
import { parsed } from '../test/parsed'

beforeAll(async () => {
  await loadCompletion()
  await loadLineCommands()
})

function type(doc: string, selection: { anchor: number; head: number }, character: string): EditorState {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(selection.anchor, selection.head),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        modeExtensions(),
        completionExtensions(),
      ],
    }),
  )

  const view = {
    get state() {
      return state
    },
    compositionStarted: false,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView

  const { from, to } = state.selection.main
  for (const handler of state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, character, () => state.update({}))) return state
  }

  return state.update({
    changes: { from, to, insert: character },
    selection: EditorSelection.cursor(from + character.length),
  }).state
}

describe('a mark typed over a whole picked line or several blocks', () => {
  test('a list item keeps its marker outside the emphasis', () => {
    const doc = '- item\n'
    expect(type(doc, { anchor: 0, head: 6 }, '*').doc.toString()).toBe('- *item*\n')
  })

  test('a heading keeps its hashes outside the emphasis', () => {
    const doc = '# Title\n'
    expect(type(doc, { anchor: 0, head: 7 }, '_').doc.toString()).toBe('# _Title_\n')
  })

  test('two paragraphs get a run each', () => {
    const doc = 'one\n\ntwo'
    expect(type(doc, { anchor: 0, head: doc.length }, '*').doc.toString()).toBe('*one*\n\n*two*')
  })
})
