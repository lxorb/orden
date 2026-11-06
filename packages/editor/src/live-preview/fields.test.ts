// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { PropertiesMode } from '@orden/markdown/properties'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { parsed } from '../../test/parsed'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { propertiesMode } from './hidden-front-matter'
import { openProperties } from './properties'
import { livePreview } from '.'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const leaveNow = StateEffect.define()

const leavesMidUpdate = ViewPlugin.define(() => ({
  update(update) {
    if (!update.transactions.some((one) => one.effects.some((effect) => effect.is(leaveNow)))) {
      return
    }
    const focused = document.activeElement
    if (focused instanceof HTMLElement) focused.blur()
  },
}))

let views: EditorView[] = []
const thrown: unknown[] = []
const heard = (event: ErrorEvent) => thrown.push(event.error)

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
  thrown.length = 0
  window.removeEventListener('error', heard)
})

function viewOf(doc: string, mode: PropertiesMode = 'properties') {
  window.addEventListener('error', heard)
  const parent = document.createElement('div')
  document.body.append(parent)
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        propertiesMode.of(mode),
        livePreview(),
        leavesMidUpdate,
      ],
    }),
  )
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

async function settled() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('a field in the page left while the editor is updating', () => {
  test("a code block's language is written, after the update", async () => {
    const view = viewOf('words\n\n```js\nconst a = 1\n```\n\nafter\n')
    const label = view.dom.querySelector<HTMLElement>('.nib-fence-language')
    if (!label) throw new Error('no language drawn')
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const field = view.dom.querySelector<HTMLInputElement>('.nib-fence-language-input')
    if (!field) throw new Error('no field to type the language in')
    field.value = 'python'

    view.dispatch({ effects: leaveNow.of(null) })
    await settled()

    expect(thrown).toEqual([])
    expect(view.state.doc.toString()).toContain('```python\n')
  })

  test("a code block's language is not written over a fence that changed meanwhile", async () => {
    const view = viewOf('```js\nconst a = 1\n```\n')
    const label = view.dom.querySelector<HTMLElement>('.nib-fence-language')
    label?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const field = view.dom.querySelector<HTMLInputElement>('.nib-fence-language-input')
    if (!field) throw new Error('no field to type the language in')
    field.value = 'python'

    view.dispatch({ changes: { from: 3, to: 5, insert: 'ts' }, effects: leaveNow.of(null) })
    await settled()

    expect(thrown).toEqual([])
    expect(view.state.doc.toString()).toBe('```ts\nconst a = 1\n```\n')
  })

  test("a property's value is written, after the update", async () => {
    const view = viewOf('---\ntitle: A note\n---\n\nWords.\n')
    view.dispatch({ effects: openProperties.of(true) })
    const field = view.dom.querySelector<HTMLInputElement>('.property-field')
    if (!field) throw new Error('no field for the title')
    field.focus()
    field.value = 'Another'
    vi.spyOn(field, 'blur').mockImplementation(() => {
      field.dispatchEvent(new Event('change'))
      field.dispatchEvent(new FocusEvent('blur'))
    })

    view.dispatch({ effects: leaveNow.of(null) })
    await settled()

    expect(thrown).toEqual([])
    expect(view.state.doc.toString()).toContain('title: Another')
  })
})
