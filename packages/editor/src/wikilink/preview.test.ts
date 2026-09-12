import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { imageResolver } from '../images'
import { type NoteIndex, noteIndexExtension } from './notes'
import { renderNote } from './preview'

/** A note shown rather than edited goes through the app's render and no other.
 *
 *  The bug this pins: the preview and the embed used to render a note here, with
 *  a renderer that cannot colour a fence, cannot draw a diagram, cannot read the
 *  note an embed names and does not know where a picture lives - so a code block
 *  in a hover preview arrived as grey text and a callout as a plain quote, while
 *  the reading view of the same note showed both properly. There is one render
 *  now, the reading view's, and this is the editor's half of the proof: what the
 *  app hands back is what goes on screen, unwrapped and unrepeated. */

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

    // Back exactly as it came: a second pass here is how the two drifted.
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

    // A picture and a link in an embedded note point from where that note sits.
    expect(asked).toEqual(['ideas/Plan.md'])
  })

  test('falls back to a plain render only where no app answers', async () => {
    const html = await renderNote('# One\n\n![a](one.png)\n', 'Today.md', state())

    expect(html).toContain('<h1>One</h1>')
    // The one thing the editor alone can still do: point a picture at the host.
    expect(html).toContain('src="asset://one.png"')
  })

  test('shows the HTML in a note as characters where no app answers', async () => {
    const html = await renderNote('<u>u</u>\n', 'Today.md', state())

    // Nothing here can ask whose note it is, so it is read as words; the reading
    // view asks trust.ts and is handed the answer.
    expect(html).toContain('&lt;u&gt;')
  })
})
