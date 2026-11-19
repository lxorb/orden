import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { blockNamer } from './block-namer'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex } from './notes'
import { parsed } from '../../test/parsed'

const GROCERIES = '# Groceries\n\n- milk\n- eggs\n- bread\n'
async function pickBlock(
  label: string,
  read: (source: string, id: string) => string | null = (source, id) => sectionOf(source, { heading: null, block: id }),
): Promise<string | null> {
  let source = GROCERIES
  const picked: { id: string | null } = { id: null }
  const index: NoteIndex = {
    notes: [{ path: 'Groceries.md', name: 'Groceries', headings: ['Groceries'], blocks: [], aliases: [] }],
    files: [],
    path: 'Today.md',
    read: () => Promise.resolve(source),
  }
  const doc = '[[Groceries#^'
  let built = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
        blockNamer.of((_path, line) => {
          const result = namedBlock(source, line, () => 'new123')
          if (!result) return Promise.resolve(null)
          source = result.source
          picked.id = result.id
          return Promise.resolve(result.id)
        }),
      ],
    }),
  )
  const found = await wikilinkCompletions(new CompletionContext(built, doc.length, false))
  const row = found?.options.find((one) => one.label === label)
  if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  row.apply(view, row, found.from, doc.length)
  await Promise.resolve()
  await Promise.resolve()
  if (picked.id === null) return null
  return read(source, picked.id)
}
describe('picking a list from the block completion', () => {
  test('links to a block that shows the item it was labelled with', async () => {
    const shown = await pickBlock('milk')
    expect(shown).toContain('milk')
  })
})
