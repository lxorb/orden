import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { blockNamer } from './block-namer'
import { wikilinkCompletions } from './complete'
import { noteIndex, type NoteIndex } from './notes'

test('a block of this very note named above the caret gets the link where it was typed', async () => {
  const doc = 'first block\n\nsee [[#^'
  let built: EditorState
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  const index: NoteIndex = {
    notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }],
    files: [],
    path: 'Plan.md',
    read: () => Promise.resolve(built.doc.toString()),
  }
  built = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
      noteIndex.of(index),
      blockNamer.of(async () => {
        view.dispatch({ changes: { from: 'first block'.length, insert: ' ^abc123' } })
        return 'abc123'
      }),
    ],
  })
  const found = await wikilinkCompletions(new CompletionContext(built, doc.length, false))
  const row = found?.options.find((one) => one.label === 'first block')
  if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')
  row.apply(view, row, found.from, doc.length)
  await new Promise((done) => setTimeout(done))
  expect(built.doc.toString()).toBe('first block ^abc123\n\nsee [[#^abc123]]')
})
