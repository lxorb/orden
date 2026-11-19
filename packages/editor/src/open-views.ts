import { EditorView, ViewPlugin } from '@codemirror/view'

const views = new Set<EditorView>()
export const enrolled = ViewPlugin.define((view: EditorView) => {
  views.add(view)
  return {
    destroy() {
      views.delete(view)
    },
  }
})
export const openViews = (): Iterable<EditorView> => views
