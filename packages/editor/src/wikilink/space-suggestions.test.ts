import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { tagCompletions } from '../tags'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef, type SpaceTag } from './notes'

const many = Array.from({ length: 45 }, (_, at) => String(at).padStart(2, '0'))

function note(path: string, headings: string[] = [], blocks: string[] = []): NoteRef {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '')
  return { path, name, headings, blocks, aliases: [] }
}

function stateFor(typed: string, notes: NoteRef[], tags: SpaceTag[] = []): EditorState {
  const index: NoteIndex = { notes, files: [], path: null, tags, read: () => Promise.resolve(null) }
  return parsed(
    EditorState.create({
      doc: typed,
      selection: EditorSelection.cursor(typed.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(index)],
    }),
  )
}

async function linked(typed: string, notes: NoteRef[]): Promise<string[]> {
  const state = stateFor(typed, notes)
  const found = await wikilinkCompletions(new CompletionContext(state, typed.length, false))
  return (found?.options ?? []).map((one) => one.label)
}

describe('suggestions across a space with more than forty matches', () => {
  test('[[## offers the heading named exactly what is typed', async () => {
    const notes = [...many.map((at) => note(`Days/${at}.md`, [`Plans for day ${at}`])), note('Plan.md', ['Plans'])]
    expect(await linked('[[##Plans', notes)).toContain('Plans')
  })

  test('[[^^ offers the block named exactly what is typed', async () => {
    const notes = [...many.map((at) => note(`Days/${at}.md`, [], [`step${at}`])), note('S.md', [], ['step'])]
    expect(await linked('[[^^step', notes)).toContain('^step')
  })

  test('# offers the tag named exactly what is typed', () => {
    const tags = [...many.map((at) => ({ tag: `work${at}`, notes: 9 })), { tag: 'work', notes: 1 }]
    const typed = 'See #work'
    const state = stateFor(typed, [], tags)
    const found = tagCompletions(new CompletionContext(state, typed.length, false))
    expect((found?.options ?? []).map((one) => one.label)).toContain('work')
  })
})
