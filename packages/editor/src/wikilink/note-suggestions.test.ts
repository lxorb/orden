import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef } from './notes'

function note(path: string): NoteRef {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '')
  return { path, name, headings: [], blocks: [], aliases: [] }
}

const twoDigits = (at: number) => String(at).padStart(2, '0')

async function offered(typed: string, notes: NoteRef[]): Promise<string[]> {
  const index: NoteIndex = { notes, files: [], path: null, read: () => Promise.resolve(null) }
  const state = parsed(
    EditorState.create({
      doc: typed,
      selection: EditorSelection.cursor(typed.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
      ],
    }),
  )
  const found = await wikilinkCompletions(new CompletionContext(state, typed.length, false))
  return (found?.options ?? []).map((one) => one.label)
}

describe('note suggestions in a space with more than forty matching notes', () => {
  test('[[Meeting offers the note named Meeting though a Meetings folder holds 45 notes', async () => {
    const standups = Array.from({ length: 45 }, (_, at) =>
      note(`Meetings/2024-03-${twoDigits(at)} Standup.md`),
    )
    expect(await offered('[[Meeting', [...standups, note('Templates/Meeting.md')])).toContain(
      'Meeting',
    )
  })

  test('[[Plan offers the note named exactly Plan ahead of 45 Planning notes listed before it', async () => {
    const planning = Array.from({ length: 45 }, (_, at) =>
      note(`Archive/Planning ${twoDigits(at)}.md`),
    )
    expect(await offered('[[Plan', [...planning, note('Plan.md')])).toContain('Plan')
  })
})
