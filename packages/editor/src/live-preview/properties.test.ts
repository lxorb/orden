// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { PropertiesMode } from '@orden/markdown/properties'
import { afterEach, describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { propertiesMode } from './hidden-front-matter'
import { newProperty, openProperties, propertiesOpen, showProperties } from './properties'
import { livePreview } from '.'

const NOTE = '---\ntitle: A note\ntags: [one, two]\n---\n\n# A note\n\nWords.\n'
const PAGE = NOTE.indexOf('# A note')

let views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
})

function viewOf(doc: string, mode: PropertiesMode = 'properties', cursor = PAGE) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        propertiesMode.of(mode),
        livePreview(),
      ],
    }),
  )
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

const strip = (view: EditorView) => view.dom.querySelector<HTMLElement>('.nib-properties')
const rows = (view: EditorView) =>
  [...view.dom.querySelectorAll<HTMLElement>('.nib-properties .property')].map(
    (row) => row.dataset.key,
  )

describe('the properties strip', () => {
  test('starts folded: one line with the count and what each key says', () => {
    const view = viewOf(NOTE)
    const head = strip(view)?.querySelector('.nib-properties-head')

    expect(strip(view)?.dataset.open).toBe('false')
    expect(head?.getAttribute('aria-expanded')).toBe('false')
    expect(head?.querySelector('.nib-properties-count')?.textContent).toBe('2')
    expect(head?.querySelector('.nib-properties-said')?.textContent).toBe(
      'title A notetags one, two',
    )
    expect(rows(view)).toEqual([])
  })

  test('opens into the rows on a press, and folds again on the next', () => {
    const view = viewOf(NOTE)
    const press = () =>
      strip(view)
        ?.querySelector('.nib-properties-head')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    press()
    expect(view.state.field(propertiesOpen)).toBe(true)
    expect(rows(view)).toEqual(['title', 'tags'])
    expect(strip(view)?.querySelector('.nib-property-add')).not.toBeNull()
    expect(view.state.doc.toString()).toBe(NOTE)

    press()
    expect(rows(view)).toEqual([])
  })

  test('stays open when a value is written, since the rows are drawn again', () => {
    const view = viewOf(NOTE)
    view.dispatch({ effects: openProperties.of(true) })
    view.dispatch({
      changes: { from: NOTE.indexOf('A note'), to: NOTE.indexOf('A note') + 6, insert: 'B' },
    })
    expect(rows(view)).toEqual(['title', 'tags'])
  })

  test('is not there for a note with no front matter', () => {
    expect(strip(viewOf('# A note\n\nWords.\n'))).toBeNull()
  })
})

describe('Show properties', () => {
  test('opens the strip and puts the keyboard on its line', () => {
    const view = viewOf(NOTE)
    expect(showProperties(view)).toBe(true)

    expect(view.state.field(propertiesOpen)).toBe(true)
    expect(document.activeElement?.classList.contains('nib-properties-head')).toBe(true)
  })

  test('takes a caret out of the block, where it would have drawn the YAML instead', () => {
    const view = viewOf(NOTE)
    view.dispatch({ selection: EditorSelection.cursor(6) })
    expect(strip(view)).toBeNull()

    showProperties(view)
    expect(strip(view)).not.toBeNull()
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(NOTE.indexOf('---\n\n') + 4)
  })

  test('shows the YAML where the reader keeps front matter hidden', () => {
    const view = viewOf(NOTE, 'hidden')
    showProperties(view)

    const line = view.state.doc.lineAt(view.state.selection.main.head)
    expect(line.number).toBe(2)
    expect(view.dom.querySelector('.cm-content')?.textContent).toContain('title: A note')
  })

  test('gives a note with none its first one', () => {
    const view = viewOf('# A note\n')
    showProperties(view)
    expect(view.state.doc.toString()).toBe('---\nproperty1: \n---\n\n# A note\n')
  })
})

describe('Add a property', () => {
  test('writes the block where there is none, with the new name selected', () => {
    const view = viewOf('Words.\n')
    expect(newProperty(view)).toBe(true)

    const { from, to } = view.state.selection.main
    expect(view.state.doc.toString()).toBe('---\nproperty1: \n---\n\nWords.\n')
    expect(view.state.sliceDoc(from, to)).toBe('property1')
  })

  test('adds a key in front of the closing fence, named after the ones already there', () => {
    const view = viewOf('---\nproperty3: x\n---\nWords.\n')
    newProperty(view)

    const { from, to } = view.state.selection.main
    expect(view.state.doc.toString()).toBe('---\nproperty3: x\nproperty2: \n---\nWords.\n')
    expect(view.state.sliceDoc(from, to)).toBe('property2')
  })

  test('writes nothing in a note that cannot be written', () => {
    const locked = new EditorView({
      state: EditorState.create({ doc: 'Words.\n', extensions: [EditorState.readOnly.of(true)] }),
    })
    views.push(locked)
    expect(newProperty(locked)).toBe(false)
    expect(locked.state.doc.toString()).toBe('Words.\n')
  })
})
