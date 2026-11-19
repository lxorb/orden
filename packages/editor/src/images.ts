import { EditorSelection, type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { embedKind, encodeTarget, formatWikilink } from '@orden/markdown/links'
import { later } from './shared'
import { fileLinkName, type NoteIndex, noteIndex, spacePathOf } from './wikilink/notes'

export type ImageSink = (file: File) => Promise<string | null>
export interface CarriedFiles {
  carries: (transfer: DataTransfer | null) => boolean
  read: (transfer: DataTransfer | null) => Promise<File[]> | null
}
export type ImageResolver = (src: string, wikilink?: boolean) => string
export const imageResolver = Facet.define<ImageResolver, ImageResolver>({
  combine: (values) => values[0] ?? ((src) => src),
})
const isImage = (file: File): boolean => file.type.startsWith('image/')
const isKept = (file: File): boolean => isImage(file) || embedKind(file.name) !== null
function markdownFor(file: File, path: string, index: NoteIndex): string {
  if (isImage(file)) return `![](${encodeTarget(path)})`
  const target = fileLinkName(index, spacePathOf(index, path))
  return formatWikilink({ target, heading: null, block: null, alias: null, embed: true })
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
interface Drop {
  key: number
  at: number
}
const dropAt = StateEffect.define<Drop>()
const dropDone = StateEffect.define<number>()
const dropPoints = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(value, transaction) {
    let next = value
    if (transaction.docChanged && value.size) {
      next = new Map([...value].map(([key, at]) => [key, transaction.changes.mapPos(at, 1)] as const))
    }
    for (const effect of transaction.effects) {
      if (effect.is(dropAt)) next = new Map(next).set(effect.value.key, effect.value.at)
      else if (effect.is(dropDone) && next.has(effect.value)) {
        const left = new Map(next)
        left.delete(effect.value)
        next = left
      }
    }
    return next
  },
})
let drops = 0
export async function receiveImages(
  view: EditorView,
  files: readonly File[] | Promise<readonly File[]>,
  sink: ImageSink,
  at: number | null,
) {
  if (!(files instanceof Promise) && !files.some(isKept)) return
  const land = later(view)
  const key = ++drops
  if (at !== null) view.dispatch({ effects: dropAt.of({ key, at }) })
  const kept = (files instanceof Promise ? await files : files).filter(isKept)
  const written: string[] = []
  for (const file of kept) {
    const path = await sink(file)
    if (path) written.push(markdownFor(file, path, view.state.facet(noteIndex)))
  }
  if (!written.length) {
    if (at !== null) view.dispatch({ effects: dropDone.of(key) })
    return
  }
  const markdown = written.join('\n')
  land((state) => {
    if (state.readOnly) return null
    const range = state.selection.main
    const point = at === null ? undefined : state.field(dropPoints, false)?.get(key)
    const mapped = state === view.state ? (point ?? null) : at
    const from = mapped ?? range.from
    const to = mapped ?? range.to
    return {
      changes: { from, to, insert: markdown },
      selection: EditorSelection.cursor(from + markdown.length),
      scrollIntoView: true,
      userEvent: 'input.paste',
      effects: dropDone.of(key),
    }
  })
}
export function imageHandling(sink: ImageSink, carried?: CarriedFiles): Extension {
  const over = (event: DragEvent, view: EditorView): boolean => {
    if (view.state.readOnly) return false
    if (
      carried?.carries(event.dataTransfer) ||
      [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file' && item.type !== 'application/pdf')
    ) {
      event.preventDefault()
    }
    return false
  }
  return [
    dropPoints,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (view.state.readOnly) return false
        const data = event.clipboardData
        const files = [...(data?.files ?? [])]
        if (!files.some(isKept)) return false
        if (wordsBesidePicture(data?.getData('text/html') ?? '', data?.getData('text/plain') ?? '')) {
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
        void receiveImages(view, reading, sink, at)
        return true
      },
      dragenter: over,
      dragover: over,
    }),
  ]
}
