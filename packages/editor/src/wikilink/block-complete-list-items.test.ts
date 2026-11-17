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

async function pickBlock(note: string, label: string): Promise<string | null> {
  let source = note
  const picked: { id: string | null } = { id: null }
  const index: NoteIndex = {
    notes: [{ path: 'List.md', name: 'List', headings: [], blocks: [], aliases: [] }],
    files: [],
    path: 'Today.md',
    read: () => Promise.resolve(source),
  }
  const doc = '[[List#^'
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
  if (picked.id === null) {
    const link = /\^([\w-]+)/u.exec(built.doc.toString())?.[1]
    return link ? sectionOf(source, { heading: null, block: link }) : null
  }
  return sectionOf(source, { heading: null, block: picked.id })
}

describe('picking a list item from the block completion', () => {
  test('the first item of a list right under a line of words links to that item', async () => {
    const shown = await pickBlock('Shopping:\n- milk\n- eggs\n', 'milk')
    expect(shown).toContain('milk')
    expect(shown).not.toContain('Shopping')
  })

  test('the item after a wrapped item links to that item, not the wrapped one', async () => {
    const shown = await pickBlock('- milk from the\n  corner shop\n- eggs\n- bread\n', 'eggs')
    expect(shown).toContain('eggs')
    expect(shown).not.toContain('milk')
  })

  test('the item after a named wrapped item does not take its name', async () => {
    const shown = await pickBlock('- milk from the\n  corner shop ^milk\n- eggs\n', 'eggs')
    expect(shown).toContain('eggs')
    expect(shown).not.toContain('milk')
  })
})
