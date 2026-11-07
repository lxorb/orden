import { afterEach, expect, test } from 'vitest'
import { createEditor, type EditorView, loadLineCommands, SharedDoc } from '@orden/editor'

const landed = () => loadLineCommands()

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function paste(into: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (kind: string) => (kind === 'text/plain' ? text : ''), files: [] },
  })
  into.contentDOM.dispatchEvent(event)
}

test('an address pasted over words is linked in that note though the pane moved on', async () => {
  const first = new SharedDoc('Read the field notes today.')
  const second = new SharedDoc('A different note entirely.')
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: first.text.toString() })
  first.join(view)
  view.dispatch({ selection: { anchor: 9, head: 20 } })

  paste(view, 'https://example.com/notes')
  second.join(view)

  await landed()
  expect(first.text.toString()).toBe('Read the [field notes](https://example.com/notes) today.')
  expect(second.text.toString()).toBe('A different note entirely.')
  expect(view.state.doc.toString()).toBe('A different note entirely.')
})

test('a paste that lands on the note it was made in is written where the caret is', async () => {
  const note = new SharedDoc('Read the field notes today.')
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: note.text.toString() })
  note.join(view)
  view.dispatch({ selection: { anchor: 9, head: 20 } })

  paste(view, 'https://example.com/notes')

  await landed()
  expect(note.text.toString()).toBe('Read the [field notes](https://example.com/notes) today.')
  expect(view.state.doc.toString()).toBe(note.text.toString())
})

function pastePicture(into: EditorView, file: File) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => '', files: [file] },
  })
  into.contentDOM.dispatchEvent(event)
}

test('a picture written a moment late is linked in the note it was pasted in', async () => {
  const first = new SharedDoc('Before after.')
  const second = new SharedDoc('A different note entirely.')
  const parent = document.createElement('div')
  document.body.append(parent)

  let write: (path: string) => void = () => undefined
  const written = new Promise<string>((done) => (write = done))
  view = createEditor({ parent, doc: first.text.toString(), onImage: () => written })
  first.join(view)
  view.dispatch({ selection: { anchor: 7 } })

  pastePicture(view, new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }))
  second.join(view)
  write('pictures/shot.png')
  await written
  await new Promise((done) => setTimeout(done, 0))

  expect(first.text.toString()).toBe('Before ![](pictures/shot.png)after.')
  expect(second.text.toString()).toBe('A different note entirely.')
  expect(view.state.doc.toString()).toBe('A different note entirely.')
})

test('a picture pasted into the note still open lands where the caret now is', async () => {
  const note = new SharedDoc('Before after.')
  const parent = document.createElement('div')
  document.body.append(parent)

  let write: (path: string) => void = () => undefined
  const written = new Promise<string>((done) => (write = done))
  view = createEditor({ parent, doc: note.text.toString(), onImage: () => written })
  note.join(view)
  view.dispatch({ selection: { anchor: 7 } })

  pastePicture(view, new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }))
  view.dispatch({ changes: { from: 0, insert: 'Typed. ' } })
  write('pictures/shot.png')
  await written
  await new Promise((done) => setTimeout(done, 0))

  expect(note.text.toString()).toBe('Typed. Before ![](pictures/shot.png)after.')
  expect(view.state.doc.toString()).toBe(note.text.toString())
})
