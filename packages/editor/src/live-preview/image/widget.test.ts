// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import '@nib/markdown/eager'
import { nibMarkdownExtensions } from '../../markdown/extensions'
import { livePreview } from '..'

/** A picture's alt field, written on blur - which Chromium sends while the editor is
 *  still taking the field out of the page, as jsdom does not; emulated here. */

const DOC = 'words\n\n![A cat](cat.png)\n\nend'
const errors: unknown[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  window.addEventListener('error', (event) => errors.push(event.error))
  Node.prototype.removeChild = <T extends Node>(child: T): T => {
    const focused = document.activeElement
    if (focused && child.contains(focused)) focused.dispatchEvent(new FocusEvent('blur'))
    ;(child as Node as ChildNode).remove()
    return child
  }
})

afterEach(() => {
  errors.length = 0
})

function typedAlt(text: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      selection: EditorSelection.cursor(DOC.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        livePreview(),
      ],
    }),
    parent: document.body,
  })
  const alt = view.contentDOM.querySelector('input')
  alt?.focus()
  if (alt) alt.value = text
  return view
}

test('is written to the picture when the field is left', async () => {
  const view = typedAlt('A dog')
  view.focus()
  await Promise.resolve()
  expect(view.state.doc.toString()).toBe(DOC.replace('A cat', 'A dog'))
  view.destroy()
})

test('is let go of, and throws nothing, when its picture was taken away', async () => {
  const view = typedAlt('A dog')
  view.dispatch({ changes: { from: DOC.indexOf('!'), to: DOC.indexOf('\n\nend'), insert: '' } })
  await Promise.resolve()
  expect(errors).toEqual([])
  expect(view.state.doc.toString()).toBe('words\n\n\n\nend')
  view.destroy()
})
