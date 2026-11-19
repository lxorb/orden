import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef } from './notes'

const topics = ['Meeting', 'Project', 'Plan', 'Journal', 'Idea', 'Reading', 'Travel', 'Health']
const notes: NoteRef[] = Array.from({ length: 3000 }, (_, at) => {
  const name = `${topics[at % topics.length] ?? 'Note'} ${String(at)}`
  return {
    path: `${topics[(at * 3) % topics.length] ?? 'Notes'}/${name}.md`,
    name,
    headings: ['Agenda', 'Decisions', 'Next steps'],
    blocks: [`step${String(at)}`],
    aliases: [],
  }
})
async function timed(typed: string): Promise<{ ms: number; shown: number }> {
  const index: NoteIndex = { notes, files: [], path: null, read: () => Promise.resolve(null) }
  const state = parsed(
    EditorState.create({
      doc: typed,
      selection: EditorSelection.cursor(typed.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(index)],
    }),
  )
  const started = performance.now()
  const found = await wikilinkCompletions(new CompletionContext(state, typed.length, false))
  return { ms: performance.now() - started, shown: found?.options.length ?? 0 }
}
describe('suggestions per keystroke in a space of 3,000 notes', () => {
  test('typing [[a answers in well under half a second', async () => {
    const { ms, shown } = await timed('[[a')
    expect(shown).toBe(40)
    expect(ms).toBeLessThan(400)
  }, 60000)
  test('typing [[##e answers in well under half a second', async () => {
    const { ms, shown } = await timed('[[##e')
    expect(shown).toBe(40)
    expect(ms).toBeLessThan(400)
  }, 60000)
  test('typing [[^^s answers in well under half a second', async () => {
    const { ms, shown } = await timed('[[^^s')
    expect(shown).toBe(40)
    expect(ms).toBeLessThan(400)
  }, 60000)
})
