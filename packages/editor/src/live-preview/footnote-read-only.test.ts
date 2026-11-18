// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'
import { noReveal } from './reveal'

const NOTE = ['See this[^a] here.', '', 'More words.', '', '[^a]: What a says.', ''].join('\n')

let views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
})

function readOnlyView(doc: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          noReveal.of(true),
        ],
      }),
    ),
  })
  views.push(view)
  return view
}

const press = (element: Element) =>
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))

const numbers = (view: EditorView) => [...view.dom.querySelectorAll('.orden-footnote-number')]

describe('a footnote in Read-only mode', () => {
  test('goes to its definition and back again from the number there', () => {
    const view = readOnlyView(NOTE)
    const [mark] = numbers(view)
    if (mark) press(mark)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('What a says'))

    const [, back] = numbers(view)
    if (back) press(back)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('[^a]') + 4)
  })
})
