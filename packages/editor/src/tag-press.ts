import { Facet, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { label } from './labels'
import { MAC, modifier } from './links'

export type TagOpener = (tag: string) => void

export const tagOpener = Facet.define<TagOpener, TagOpener | null>({
  combine: (values) => values[0] ?? null,
})

export function tagTitle(state: EditorState): string | null {
  if (!state.facet(tagOpener)) return null
  return label(MAC ? 'searchTagMac' : 'searchTag')
}

export const tagClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(modifier(event) || view.state.readOnly)) return false

    const open = view.state.facet(tagOpener)
    if (!open) return false

    const target = event.target
    const tag = target instanceof Element ? target.closest('.tag[data-tag]') : null
    const name = tag?.getAttribute('data-tag')
    if (!name) return false

    event.preventDefault()
    open(name)
    return true
  },
})
