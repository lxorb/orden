// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, expect, test } from 'vitest'
import { type CarriedFiles, imageHandling } from './images'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const ROWS = {
  types: ['text/nib-explorer'],
  files: [],
  items: [],
  getData: () => '',
} as unknown as DataTransfer

function dragged(type: 'dragover' | 'drop', view: EditorView): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: ROWS })
  view.contentDOM.dispatchEvent(event)
  return event
}

test('rows carried from outside as files land in the note as dropped files do', async () => {
  const carried: CarriedFiles = {
    carries: (transfer) => transfer === ROWS,
    read: (transfer) =>
      transfer === ROWS
        ? Promise.resolve([
            new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }),
            new File([new Uint8Array([2])], 'notes.bin', { type: '' }),
          ])
        : null,
  }
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'one\n',
      selection: { anchor: 4 },
      extensions: [imageHandling((file) => Promise.resolve(`assets/${file.name}`), carried)],
    }),
  })

  view.posAtCoords = () => 4
  expect(dragged('dragover', view).defaultPrevented).toBe(true)
  expect(dragged('drop', view).defaultPrevented).toBe(true)
  await expect.poll(() => view.state.doc.toString()).toBe('one\n![](assets/shot.png)')
  view.destroy()
})
