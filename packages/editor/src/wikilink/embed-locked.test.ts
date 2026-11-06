// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { parseWikilink } from '@orden/markdown/links'
import { afterEach, describe, expect, test } from 'vitest'
import type { LinkSpan } from './at'
import { EmbedWidget, embedWidget } from './embed'
import { type NoteIndex, noteIndex } from './notes'

let view: EditorView | undefined
afterEach(() => view?.destroy())

function link(inner: string): LinkSpan {
  const parsed = parseWikilink(inner, true)
  if (!parsed) throw new Error(`${inner} is not a link`)
  return { ...parsed, kind: 'wikilink', from: 0, to: 0 }
}

describe('an embedded note that is protected and shut', () => {
  test('says so, and its words are never asked for', () => {
    const asked: string[] = []
    const index: NoteIndex = {
      notes: [{ path: 'Diary.md', name: 'Diary', headings: [], blocks: [], aliases: [] }],
      files: [],
      path: 'Today.md',
      read: (path) => {
        asked.push(path)
        return Promise.resolve('the secret words')
      },
      locked: (path) => path === 'Diary.md',
    }
    const state = EditorState.create({ extensions: [noteIndex.of(index)] })
    view = new EditorView({ state })
    const widget = embedWidget(state, link('Diary'))
    expect(widget).toBeInstanceOf(EmbedWidget)

    const drawn = widget.toDOM(view)
    expect(drawn.textContent).toContain('Protected')
    expect(drawn.textContent).not.toContain('secret')
    expect(asked).toEqual([])
  })
})
