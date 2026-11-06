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
