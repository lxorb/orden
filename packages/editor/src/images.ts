import { EditorSelection, type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { embedKind, encodeTarget, formatWikilink } from '@orden/markdown/links'

export type ImageSink = (file: File) => Promise<string | null>

export interface CarriedFiles {
  carries: (transfer: DataTransfer | null) => boolean
  read: (transfer: DataTransfer | null) => Promise<File[]> | null
}

export const imageResolver = Facet.define<(src: string) => string, (src: string) => string>({
  combine: (values) => values[0] ?? ((src) => src),
})

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

function isKept(file: File): boolean {
  return isImage(file) || embedKind(file.name) !== null
}

function markdownFor(file: File, path: string): string {
  if (isImage(file)) return `![](${encodeTarget(path)})`

  const name = path.slice(path.lastIndexOf('/') + 1)
  return formatWikilink({ target: name, heading: null, block: null, alias: null, embed: true })
}

export function wordsBesidePicture(html: string, text: string): boolean {
  if (!text.trim()) return false
  if (text.includes('\t')) return true

  const words = html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(?:"[^"]*"|'[^']*'|[^>"'])*>/gu, '')
    .replace(/&nbsp;|&#160;/giu, ' ')
  return words.trim() !== ''
}

const dropAt = StateEffect.define<number | null>()

const dropPoint = StateField.define<number | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(dropAt)) return effect.value
    }
    if (value === null || !transaction.docChanged) return value
    return transaction.changes.mapPos(value, 1)
  },
})

export async function receiveImages(
  view: EditorView,
  files: File[],
  sink: ImageSink,
  at: number | null,
) {
  const kept = files.filter(isKept)
  if (!kept.length) return

  view.dispatch({ effects: dropAt.of(at) })

  const written: string[] = []
  for (const file of kept) {
    const path = await sink(file)
    if (path) written.push(markdownFor(file, path))
  }
  if (!written.length) return

  if (view.state.readOnly) return

  const markdown = written.join('\n')
  const range = view.state.selection.main
  const mapped = view.state.field(dropPoint, false) ?? null
  const from = mapped ?? range.from
  const to = mapped ?? range.to

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: EditorSelection.cursor(from + markdown.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
    effects: dropAt.of(null),
  })
}

export function imageHandling(sink: ImageSink, carried?: CarriedFiles): Extension {
  return [
    dropPoint,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (view.state.readOnly) return false

        const data = event.clipboardData
        const files = [...(data?.files ?? [])]
        if (!files.some(isKept)) return false
        if (
          wordsBesidePicture(data?.getData('text/html') ?? '', data?.getData('text/plain') ?? '')
        ) {
          return false
        }

        event.preventDefault()
        void receiveImages(view, files, sink, null)
        return true
      },

      drop(event, view) {
        if (view.state.readOnly) return false

        const files = [...(event.dataTransfer?.files ?? [])]
        const reading = files.length ? null : (carried?.read(event.dataTransfer) ?? null)
        if (!reading && !files.some(isKept)) return false

        event.preventDefault()
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (!reading) {
          void receiveImages(view, files, sink, at)
          return true
        }
        void reading.then((read) => {
          const kept = read.filter(isKept)
          if (kept.length && !view.state.readOnly) void receiveImages(view, kept, sink, at)
        })
        return true
      },

      dragover(event, view) {
        if (view.state.readOnly) return false

        if (
          carried?.carries(event.dataTransfer) ||
          [...(event.dataTransfer?.items ?? [])].some(
            (item) => item.kind === 'file' && item.type !== 'application/pdf',
          )
        ) {
          event.preventDefault()
        }
        return false
      },
    }),
  ]
}
