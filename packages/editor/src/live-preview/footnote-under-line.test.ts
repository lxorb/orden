// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { renderMarkdown } from '@orden/markdown'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { definitionOf } from './footnotes'
import { livePreview } from '.'

const NOTE = 'This claim needs a source.[^1]\n[^1]: Smith, 2020.\n\nend\n'

let views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
})

function viewOf(doc: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
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

describe('a footnote defined on the line right under its paragraph', () => {
  test('is a definition in the reading view', () => {
    const html = renderMarkdown(NOTE, { footnotes: true })
    expect(html).toContain('class="footnotes"')
    expect(html).not.toContain('[^1]:')
  })

  test('is found as the definition in Live Preview, as the reading view reads it', () => {
    const view = viewOf(NOTE)
    expect(definitionOf(view.state, '1')).not.toBeNull()
  })

  test('jumps from the mark to the definition on a click of its number', () => {
    const view = viewOf(NOTE)
    const number = view.contentDOM.querySelector('.cm-line .orden-footnote-number')
    expect(number).not.toBeNull()
    number?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    )
    expect(view.state.selection.main.head).toBe(NOTE.indexOf('Smith'))
  })

  test('draws the definition line as a footnote, not as words of the paragraph', () => {
    const view = viewOf(NOTE)
    const line = view.contentDOM.querySelectorAll('.cm-line')[1]
    expect(line?.classList.contains('orden-footnote')).toBe(true)
  })
})
