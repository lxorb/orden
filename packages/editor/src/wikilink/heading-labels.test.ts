import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef } from './notes'

const HEADING = '3a. [Lateral Raise](https://example.com/raise) with **care**'
const PLAIN = 'Warm up'
const NOTES: NoteRef[] = [{ path: 'Gym.md', name: 'Gym', headings: [HEADING, PLAIN], blocks: [], aliases: [] }]
const index: NoteIndex = { notes: NOTES, files: [], path: 'Plan.md', read: () => Promise.resolve(null) }
function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(index)],
    }),
  )
}
const rows = async (doc: string): Promise<CompletionResult | null> =>
  await wikilinkCompletions(new CompletionContext(stateOf(doc), doc.length, false))
const shown = (found: CompletionResult | null) => (found?.options ?? []).map((one) => one.displayLabel ?? one.label)
function picked(doc: string, found: CompletionResult | null, label: string): string {
  const row = found?.options.find((one) => one.label === label)
  if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
  let built = stateOf(doc)
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  row.apply(view, row, found.from, doc.length)
  return built.doc.toString()
}
describe('a heading offered for a link reads as it is drawn', () => {
  test('the headings of one note show their words without markdown', async () => {
    const found = await rows('[[Gym#')
    expect(shown(found)).toEqual(['3a. Lateral Raise with care', PLAIN])
  })
  test('the headings of the space show their words without markdown', async () => {
    const found = await rows('[[##')
    expect(shown(found)).toEqual(['3a. Lateral Raise with care', PLAIN])
  })
  test('a heading picked is linked by the words it is written with', async () => {
    const found = await rows('[[Gym#')
    expect(picked('[[Gym#', found, HEADING)).toContain(`#${HEADING}`)
  })
})
