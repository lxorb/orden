import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { parseWikilink } from '@orden/markdown/links'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef, shownTarget } from './notes'

const OWN_TAIL = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc|chat|base|term)$/i
const ref = (path: string, name: string, more: Partial<NoteRef> = {}): NoteRef => ({
  path,
  name,
  headings: [],
  blocks: [],
  aliases: [],
  ...more,
})
const NOTES = [
  ref('Board.canvas', 'Board.canvas', { headings: ['Top'], blocks: ['b0a4d1'], aliases: ['Pinboard'] }),
  ref('links/Site.url', 'Site.url', { headings: ['Away'], blocks: ['5173e1'] }),
  ref('ideas/Ideas.canvas.md', 'Ideas.canvas'),
]
const index = (notes: NoteRef[]): NoteIndex => ({ notes, files: [], path: 'One.md', read: () => Promise.resolve(null) })
function stateOf(doc: string, notes: NoteRef[]): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index(notes)),
      ],
    }),
  )
}
async function rows(doc: string, notes = NOTES): Promise<CompletionResult | null> {
  return await wikilinkCompletions(new CompletionContext(stateOf(doc, notes), doc.length, false))
}
const seen = (found: CompletionResult | null): string[] =>
  (found?.options ?? []).flatMap((one) => [one.displayLabel ?? one.label, ...(one.detail ? [one.detail] : [])])
describe('the rows of a link being typed name files the way the file tree does', () => {
  test('a canvas and a web shortcut are offered without their endings', async () => {
    const found = await rows('[[')
    const shown = (found?.options ?? []).map((one) => one.displayLabel ?? one.label)
    expect(shown).toEqual(expect.arrayContaining(['Board', 'Site']))
    expect(shown).not.toContain('Board.canvas')
    expect(shown).not.toContain('Site.url')
  })
  test('typing the ending still finds the file', async () => {
    const found = await rows('[[Board.can')
    expect((found?.options ?? []).map((one) => one.label)).toContain('Board.canvas')
  })
  test('an alias row says the file it belongs to without the ending', async () => {
    const found = await rows('[[Pinb')
    expect(found?.options.find((one) => one.label === 'Pinboard')?.detail).toBe('Board')
  })
  test('heading rows say their file without the ending', async () => {
    expect(seen(await rows('[[##'))).not.toContainEqual(expect.stringMatching(OWN_TAIL))
  })
  test('named block rows say their file without the ending', async () => {
    expect(seen(await rows('[[^^'))).not.toContainEqual(expect.stringMatching(OWN_TAIL))
  })
  test('a note whose own name ends like a canvas keeps that name', async () => {
    const found = await rows('[[Idea')
    const row = found?.options.find((one) => one.label === 'Ideas.canvas')
    expect(row?.displayLabel ?? row?.label).toBe('Ideas.canvas')
  })
  test('picking a canvas still writes the link a tab opens it by', async () => {
    const found = await rows('[[Boa')
    const row = found?.options.find((one) => one.label === 'Board.canvas')
    if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')
    let built = stateOf('[[Boa', NOTES)
    const view = {
      get state() {
        return built
      },
      dispatch: (spec: TransactionSpec) => {
        built = built.update(spec).state
      },
    } as unknown as EditorView
    row.apply(view, row, found.from, 5)
    expect(built.doc.toString()).toBe('[[Board.canvas]]')
  })
})
describe('the name a link card or embed shows', () => {
  const link = (inner: string) => {
    const found = parseWikilink(inner, true)
    if (!found) throw new Error(inner)
    return found
  }
  test('is the file it reaches without its ending', () => {
    expect(shownTarget(link('Board.canvas'), 'maps/Board.canvas')).toBe('Board')
    expect(shownTarget(link('Plan.md#Today'), 'Plan.md')).toBe('Plan#Today')
    expect(shownTarget(link('Plan#^a1b2c3'), 'Plan.md')).toBe('Plan#^a1b2c3')
  })
  test('keeps a markdown note whose own name ends like a canvas', () => {
    expect(shownTarget(link('Ideas.canvas.md'), 'Ideas.canvas.md')).toBe('Ideas.canvas')
  })
  test('is what was written when the link reaches nothing', () => {
    expect(shownTarget(link('Gone.canvas'), null)).toBe('Gone.canvas')
  })
  test('is only the part when the link is to this note', () => {
    expect(shownTarget(link('#Today'), 'One.md')).toBe('#Today')
  })
})
