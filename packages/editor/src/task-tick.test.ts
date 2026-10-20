// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { toggleTask } from './commands'
import { noteIndex, type TaskHelp } from './wikilink/notes'

/** Ctrl+Enter on tasks in a real view, with the note changed between the press and the
 *  tick's arrival (#526): the lines it was pressed on are not taken from another note. */

const HELP: TaskHelp = {
  tick(note, line) {
    const from = note.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0)
    return Promise.resolve([{ from: from + 3, to: from + 4, insert: 'x' }])
  },
  pick: () => undefined,
  dayAtEnd: () => null,
}

const NOTE = '- [ ] one\n- [ ] two\nplain'

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function pressed(change: { from: number; to?: number; insert?: string }): Promise<string> {
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      selection: EditorSelection.range(0, NOTE.length),
      extensions: [
        markdown({ base: markdownLanguage }),
        noteIndex.of({
          notes: [],
          files: [],
          path: null,
          read: () => Promise.resolve(null),
          tasks: HELP,
        }),
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  toggleTask(view)
  view.dispatch({ changes: change })
  return new Promise((resolve) => setTimeout(() => resolve(view.state.doc.toString()), 50))
}

test('a line written above is kept and no box is broken', async () => {
  expect(await pressed({ from: 0, insert: 'new line\n' })).toBe(`new line\n${NOTE}`)
})

test('a line taken away above does not throw', async () => {
  expect(await pressed({ from: 0, to: 10 })).toBe('- [ ] two\nplain')
})
