import { EditorSelection, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Stores an image and returns the path to write into the document. Supplied by
 *  the host so the editor package stays free of platform concerns. */
export type ImageSink = (file: File) => Promise<string | null>

/** Turns a document-relative image path into something the view can load.
 *  A desktop webview cannot fetch `assets/x.png` off disk on its own. */
export const imageResolver = Facet.define<(src: string) => string, (src: string) => string>({
  combine: (values) => values[0] ?? ((src) => src),
})

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

async function insert(view: EditorView, files: File[], sink: ImageSink, at?: number) {
  const images = files.filter(isImage)
  if (!images.length) return

  const paths: string[] = []
  for (const file of images) {
    const path = await sink(file)
    if (path) paths.push(path)
  }
  if (!paths.length) return

  const markdown = paths.map((path) => `![](${encodeURI(path)})`).join('\n')
  const pos = at ?? view.state.selection.main.from

  view.dispatch({
    changes: {
      from: pos,
      to: at === undefined ? view.state.selection.main.to : pos,
      insert: markdown,
    },
    selection: EditorSelection.cursor(pos + markdown.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}

/** Paste or drop an image and it lands in the document as markdown. */
export function imageHandling(sink: ImageSink): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      // Nothing is stored while the document is read-only: the sink writes the
      // picture into the note's folder before any markdown is inserted, and a
      // file left behind by an insertion that was refused is litter.
      if (view.state.readOnly) return false

      const files = [...(event.clipboardData?.files ?? [])]
      if (!files.some(isImage)) return false

      event.preventDefault()
      void insert(view, files, sink)
      return true
    },

    drop(event, view) {
      if (view.state.readOnly) return false

      const files = [...(event.dataTransfer?.files ?? [])]
      if (!files.some(isImage)) return false

      event.preventDefault()
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined
      void insert(view, files, sink, at)
      return true
    },

    dragover(event, view) {
      // Without this the browser refuses the drop - which is what should
      // happen while the document is read-only, so there it is left unsaid.
      if (view.state.readOnly) return false

      if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) {
        event.preventDefault()
      }
      return false
    },
  })
}
