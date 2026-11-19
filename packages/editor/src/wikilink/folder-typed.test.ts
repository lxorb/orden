// @vitest-environment jsdom
import { autocompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex, type NoteRef } from './notes'

function note(path: string): NoteRef {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '')
  return { path, name, headings: [], blocks: [], aliases: [] }
}
const index: NoteIndex = {
  notes: [note('Projects/Plan.md'), note('Archive/Plan.md'), note('Inbox.md')],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve(null),
}
const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})
const settle = () => new Promise((done) => setTimeout(done, 200))
async function shownAfterTyping(typed: string): Promise<string[]> {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '[[',
      selection: EditorSelection.cursor(2),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
        autocompletion({ override: [wikilinkCompletions], activateOnTypingDelay: 0 }),
      ],
    }),
  })
  views.push(view)
  startCompletion(view)
  await settle()
  for (const letter of typed) {
    const at = view.state.selection.main.head
    view.dispatch({
      changes: { from: at, insert: letter },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    })
    await settle()
  }
  return currentCompletions(view.state).map((one) => `${one.label} ${one.detail ?? ''}`.trim())
}
describe('the note popup while a folder is typed in the editor', () => {
  test('[[Projects/Pl lists the Plan note in Projects', async () => {
    expect(await shownAfterTyping('Projects/Pl')).toContain('Plan Projects')
  })
  test('[[Pl lists both Plan notes', async () => {
    expect(await shownAfterTyping('Pl')).toEqual(expect.arrayContaining(['Plan Projects', 'Plan Archive']))
  })
})
