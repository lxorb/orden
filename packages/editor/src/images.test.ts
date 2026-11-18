import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { imageHandling, type ImageSink, receiveImages, wordsBesidePicture } from './images'
import { type NoteIndex, noteIndex } from './wikilink/notes'

const PICTURE = [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })]

function surface(doc: string, caret: number, readOnly = false, space?: NoteIndex) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [
      imageHandling(() => Promise.resolve(null)),
      EditorState.readOnly.of(readOnly),
      ...(space ? [noteIndex.of(space)] : []),
    ],
  })

  const dispatch = (spec: TransactionSpec) => {
    state = state.update(spec).state
  }

  return {
    get doc() {
      return state.doc.toString()
    },
    dispatch,
    view: {
      get state() {
        return state
      },
      dispatch,
    } as unknown as EditorView,
  }
}

function heldSink(): { sink: ImageSink; settle: (path: string) => void } {
  let settle: (path: string) => void = () => undefined
  const sink: ImageSink = () => new Promise((resolve) => (settle = resolve))
  return { sink, settle: (path) => settle(path) }
}

const settled = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('a dropped picture', () => {
  test('lands where it was dropped', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('one ![](assets/a.png)two three\n')
  })

  test('lands where the drop point ended up after an edit above it', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    editor.dispatch({ changes: { from: 0, insert: 'PREFIX ' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('PREFIX one ![](assets/a.png)two three\n')
  })

  test('lands inside what is left when the note shrank under it', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 12)
    editor.dispatch({ changes: { from: 0, to: 14, insert: 'x' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('x![](assets/a.png)')
  })

  test('a paste goes to the selection, wherever it has got to', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 4)

    const writing = receiveImages(editor.view, PICTURE, sink, null)
    editor.dispatch({ changes: { from: 0, insert: 'PREFIX ' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('PREFIX one ![](assets/a.png)two three\n')
  })

  test('is not written at all once the note refuses changes', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0, true)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('one two three\n')
  })

  test('writes nothing when the host stored nothing', async () => {
    const editor = surface('one\n', 0)
    await receiveImages(editor.view, PICTURE, () => Promise.resolve(null), 2)
    expect(editor.doc).toBe('one\n')
  })

  test('ignores files the note cannot show', async () => {
    const editor = surface('one\n', 0)
    const other = [
      new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' }),
      new File([new Uint8Array([1])], 'a.zip', { type: 'application/zip' }),
    ]
    await receiveImages(editor.view, other, () => Promise.resolve('assets/a.png'), 2)
    expect(editor.doc).toBe('one\n')
  })
})

describe('two drops written at the same time', () => {
  test('each land where they were dropped, whichever is written first', async () => {
    const first = heldSink()
    const second = heldSink()
    const editor = surface('one\ntwo\nthree\n', 0)

    const one = receiveImages(editor.view, PICTURE, first.sink, 3)
    const other = receiveImages(
      editor.view,
      [new File([new Uint8Array([1])], 'b.png', { type: 'image/png' })],
      second.sink,
      13,
    )
    first.settle('assets/a.png')
    await one
    await settled()
    second.settle('assets/b.png')
    await other
    await settled()

    expect(editor.doc).toBe('one![](assets/a.png)\ntwo\nthree![](assets/b.png)\n')
  })

  test('a paste meanwhile does not send the drop to the caret', async () => {
    const dropped = heldSink()
    const pasted = heldSink()
    const editor = surface('one\ntwo\n', 0)

    const drop = receiveImages(editor.view, PICTURE, dropped.sink, 3)
    const paste = receiveImages(
      editor.view,
      [new File([new Uint8Array([1])], 'b.png', { type: 'image/png' })],
      pasted.sink,
      null,
    )
    dropped.settle('assets/a.png')
    await drop
    await settled()
    pasted.settle('assets/b.png')
    await paste
    await settled()

    expect(editor.doc).toBe('one![](assets/a.png)![](assets/b.png)\ntwo\n')
  })
})

describe('a file still being read when it is dropped', () => {
  test('lands where the drop point ended up after typing above it meanwhile', async () => {
    let read: (files: File[]) => void = () => undefined
    const reading = new Promise<File[]>((resolve) => (read = resolve))
    const editor = surface('top\n\nend', 0)

    const writing = receiveImages(editor.view, reading, () => Promise.resolve('assets/a.png'), 5)
    editor.dispatch({ changes: { from: 3, insert: ' words' } })
    read(PICTURE)
    await writing
    await settled()

    expect(editor.doc).toBe('top words\n\n![](assets/a.png)end')
  })
})

describe('a dropped file that is not a picture', () => {
  const file = (name: string, type: string) => new File([new Uint8Array([1])], name, { type })

  test('is embedded by its name, the way Obsidian writes a dropped file', async () => {
    const editor = surface('one two\n', 0)
    const dropped = [
      file('paper one.pdf', 'application/pdf'),
      file('talk.mp3', 'audio/mpeg'),
      file('demo.mp4', 'video/mp4'),
    ]

    await receiveImages(editor.view, dropped, (one) => Promise.resolve(`assets/${one.name}`), 4)

    expect(editor.doc).toBe('one ![[paper one.pdf]]\n![[talk.mp3]]\n![[demo.mp4]]two\n')
  })

  test('sits beside the pictures dropped with it, in the order they came', async () => {
    const editor = surface('', 0)
    const dropped = [file('a.png', 'image/png'), file('b.pdf', '')]

    await receiveImages(editor.view, dropped, (one) => Promise.resolve(`../assets/${one.name}`), 0)

    expect(editor.doc).toBe('![](../assets/a.png)\n![[b.pdf]]')
  })
})

describe('a dropped file named like another file in the space', () => {
  const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'application/pdf' })
  const space = (files: string[]): NoteIndex => ({
    notes: [],
    files,
    path: 'Notes/Today.md',
    read: () => Promise.resolve(null),
  })

  test('is embedded by its path in the space, so the link opens this one', async () => {
    const editor = surface('', 0, false, space(['report.pdf']))
    await receiveImages(
      editor.view,
      [file('report.pdf')],
      () => Promise.resolve('../assets/report.pdf'),
      0,
    )
    expect(editor.doc).toBe('![[assets/report.pdf]]')
  })

  test('by its name when its path holds a mark a link reads as its end', async () => {
    const editor = surface('', 0, false, space(['report.pdf']))
    await receiveImages(
      editor.view,
      [file('report.pdf')],
      () => Promise.resolve('../C# tips/report.pdf'),
      0,
    )
    expect(editor.doc).toBe('![[report.pdf]]')
  })

  test('and by its name alone when no other file has it', async () => {
    const editor = surface('', 0, false, space(['assets/report.pdf', 'other.pdf']))
    await receiveImages(
      editor.view,
      [file('report.pdf')],
      () => Promise.resolve('../assets/report.pdf'),
      0,
    )
    expect(editor.doc).toBe('![[report.pdf]]')
  })
})

describe('a picture whose name a link would read as something else', () => {
  test('is written so the link stays one', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 0)
    settle('assets/1) scan#2.png')
    await writing
    await settled()

    expect(editor.doc).toBe('![](assets/1%29%20scan%232.png)')
  })
})

describe('a picture beside words on the clipboard', () => {
  const STYLE = '<html><head><style>td{}</style></head><body><!--StartFragment-->'

  test.each([
    [`${STYLE}<table><tr><td>Bob</td></tr></table>`, true, 'Bob'],
    [`${STYLE}<p>word&nbsp;</p>`, true, 'word'],
    ['', true, 'Name\tAge\nBob\t3'],
    ['', false, ''],
    ['<img src="https://x.co/a.png" alt="a">', false, ''],
    ['<img src="https://x.co/a.png" alt="a">', false, 'a'],
    [`${STYLE}<p><img src="a.png"></p>`, false, 'a.png'],
    ['', false, 'photo.png'],
  ])('%j', (input, wanted, extra) => expect(wordsBesidePicture(input, extra)).toEqual(wanted))
})

describe('a bracket in a picture attribute', () => {
  test('is no words', () => {
    expect(wordsBesidePicture('<img src="a.png" alt="Cat > dog">', 'Cat > dog')).toBe(false)
  })
})
