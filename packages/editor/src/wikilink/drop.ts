import { EditorSelection, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { later } from '../shared'
import { linkWriter, noteIndex } from './notes'

export const noteCarrier = Facet.define<
  (transfer: DataTransfer | null) => readonly string[],
  (transfer: DataTransfer | null) => readonly string[]
>({ combine: (values) => values[0] ?? (() => []) })

const noteLinksCode = () => import('./note-links')

function over(event: DragEvent, view: EditorView): boolean {
  if (view.state.readOnly || !carried(event, view).length) return false

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  return false
}

export const noteDrops: Extension = EditorView.domEventHandlers({
  dragenter: over,
  dragover: over,

  drop(event, view) {
    const paths = carried(event, view)
    if (view.state.readOnly || !paths.length) return false

    event.preventDefault()
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    const land = later(view)
    view.focus()

    void noteLinksCode().then(({ noteLinks }) =>
      land((state, placed) => {
        if (state.readOnly) return null

        const text = noteLinks(state.facet(noteIndex), paths, state.facet(linkWriter))
        const from = placed(at)

        return {
          changes: { from, insert: text },
          selection: EditorSelection.cursor(from + text.length),
          userEvent: 'input.drop',
        }
      }),
    )
    return true
  },
})

function carried(event: DragEvent, view: EditorView): readonly string[] {
  return view.state.facet(noteCarrier)(event.dataTransfer)
}
