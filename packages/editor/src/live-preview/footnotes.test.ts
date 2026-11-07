// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { definitionOf, definitionWords, followFootnote, footnoteAt } from './footnotes'
import { livePreview } from '.'

const NOTE = [
  'First[^a] and again[^a], then[^2].',
  '',
  '[^a]: What a says.',
  '[^2]: **Bold** words.',
  '',
].join('\n')

const SECOND = NOTE.indexOf('[^a]', NOTE.indexOf('[^a]') + 1)

let views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
})

function viewOf(doc: string, cursor = doc.length) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
        ],
      }),
    ),
  })
  views.push(view)
  return view
}

const press = (element: Element) =>
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))

describe('a footnote', () => {
  test('is read as a mark or a definition, with the label it names', () => {
    const state = viewOf(NOTE).state
    expect(footnoteAt(state, NOTE.indexOf('[^2]') + 2)).toMatchObject({ kind: 'ref', label: '2' })
    expect(footnoteAt(state, NOTE.indexOf('[^a]:') + 2)).toMatchObject({ kind: 'def', label: 'a' })
    expect(footnoteAt(state, 2)).toBeNull()
  })

  test('says its words without the label', () => {
    const state = viewOf(NOTE).state
    const definition = definitionOf(state, 'a')
    expect(definition && definitionWords(state, definition)).toBe('What a says.')
    expect(definitionOf(state, 'missing')).toBeNull()
  })

  test('goes from the mark to the definition, and back to the mark it left', () => {
    const view = viewOf(NOTE)
    const second = footnoteAt(view.state, SECOND + 2)
    expect(second && followFootnote(view, second)).toBe(true)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('What a says'))

    const definition = footnoteAt(view.state, NOTE.indexOf('[^a]:') + 2)
    expect(definition && followFootnote(view, definition)).toBe(true)
    expect(view.state.selection.main.head).toBe(SECOND + 4)
  })

  test('goes back to the first mark when the reader did not come from one', () => {
    const view = viewOf(NOTE)
    const definition = footnoteAt(view.state, NOTE.indexOf('[^2]:') + 2)
    expect(definition && followFootnote(view, definition)).toBe(true)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('[^2]') + 4)
  })

  test('goes nowhere when the note never defined it', () => {
    const view = viewOf('Words[^gone].\n')
    const mark = footnoteAt(view.state, 7)
    expect(mark && followFootnote(view, mark)).toBe(false)
  })

  test('is followed by a press on its number, drawn as one', () => {
    const view = viewOf(NOTE)
    const numbers = [...view.dom.querySelectorAll('.orden-footnote-number')]
    expect(numbers.map((one) => one.textContent)).toEqual(['a', 'a', '2', 'a', '2'])

    const [, , two] = numbers
    if (two) press(two)
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('**Bold**'))
  })

  test('leaves a press alone where the caret already shows the mark as written', () => {
    const view = viewOf(NOTE, NOTE.indexOf('[^2]') + 1)
    const two = [...view.dom.querySelectorAll('.orden-footnote-number')][2]
    if (two) press(two)
    expect(view.state.selection.main.head).not.toBe(NOTE.indexOf('**Bold**'))
  })
})
