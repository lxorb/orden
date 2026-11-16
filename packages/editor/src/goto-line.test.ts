// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from './editor'
import { gotoLine, loadFind } from './find'
import { parsed } from '../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string): EditorView {
  const view = new EditorView({
    state: parsed(editorState({ doc, selection: { anchor: 0 } })),
    parent: document.body,
  })
  open.push(view)
  return view
}

async function goTo(view: EditorView, line: number) {
  await loadFind()
  gotoLine(view)
  const field = view.dom.querySelector<HTMLInputElement>('.cm-goto-line input[type=text]')
  if (!field) throw new Error('no Go to line field')
  field.value = String(line)
  field.form?.requestSubmit()
  await new Promise((settle) => setTimeout(settle, 0))
}

describe('Go to line', () => {
  test('on a bullet item puts the caret after the hidden marker, so typing goes into the item', async () => {
    const view = viewOf('# Plan\n\n- first step\n- second step\n')
    await goTo(view, 4)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(4).text).toBe('- xsecond step')
  })

  test('on a task puts the caret after the hidden box, so typing goes into the task', async () => {
    const view = viewOf('# Plan\n\n- [ ] first step\n- [ ] second step\n')
    await goTo(view, 4)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(4).text).toBe('- [ ] xsecond step')
  })
})
