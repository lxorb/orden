import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { imageResolver } from '../images'
import { type NoteIndex, noteIndexExtension } from './notes'
import { renderNote } from './preview'

const EMPTY: NoteIndex = { notes: [], files: [], path: null, read: () => Promise.resolve(null) }

function state(index: Partial<NoteIndex> = {}): EditorState {
  return EditorState.create({
    extensions: [
      noteIndexExtension({ ...EMPTY, ...index }),
      imageResolver.of((src) => `asset://${src}`),
    ],
  })
}

const NOTE = '```ts\nlet x = 1\n```\n'

describe('a note the editor shows rather than edits', () => {
  test('is rendered by the app, and by nothing here', async () => {
    const asked: { source: string; path: string | null }[] = []
    const html = await renderNote(
      NOTE,
      'ideas/Plan.md',
      state({
        render: (source, path) => {
          asked.push({ source, path })
          return Promise.resolve('<p>the reading view said so</p>')
        },
      }),
    )

    expect(html).toBe('<p>the reading view said so</p>')
    expect(asked).toEqual([{ source: NOTE, path: 'ideas/Plan.md' }])
  })

  test('is rendered against its own path, not the note in the pane', async () => {
    const asked: (string | null)[] = []
    await renderNote(
      NOTE,
      'ideas/Plan.md',
      state({
        path: 'Today.md',
        render: (_source, path) => {
          asked.push(path)
          return Promise.resolve('')
        },
      }),
    )

    expect(asked).toEqual(['ideas/Plan.md'])
  })

  test('falls back to a plain render only where no app answers', async () => {
    const html = await renderNote('# One\n\n![a](one.png)\n', 'Today.md', state())

    expect(html).toContain('<h1>One</h1>')
    expect(html).toContain('src="asset://one.png"')
  })

  test('shows the HTML in a note as characters where no app answers', async () => {
    const html = await renderNote('<u>u</u>\n', 'Today.md', state())

    expect(html).toContain('&lt;u&gt;')
  })
})
