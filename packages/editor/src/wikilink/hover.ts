import { type EditorState, Facet } from '@codemirror/state'
import {
  activateHover,
  closeHoverTooltip,
  type EditorView,
  hoverTooltip,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { isTabFile, linkTarget, sectionLine, sectionOf } from '@orden/markdown/links'
import { followAnchors, modifierHeld } from '../links'
import { type LinkSpan, linkAt } from './at'
import { noteIndex, resolveLink } from './notes'
import { renderNote } from './preview'

const DELAY = 300
const MOST_PREVIEWED = 4000
const MOST_EDITED = 40_000
export interface PreviewNote {
  path: string
  text: string
  at: number
  readOnly: boolean
}
const CRLF = /\r?\n/g
export const previewNoteOf = (
  state: EditorState,
  path: string,
  text: string,
  section: string,
  link: Pick<LinkSpan, 'heading' | 'block'> = { heading: null, block: null },
): PreviewNote => ({
  path,
  text,
  at: lineStart(text, sectionLine(text, link)) ?? anchorOf(text.replace(CRLF, '\n'), section),
  readOnly: state.readOnly,
})
function lineStart(text: string, line: number | null): number | null {
  if (line === null) return null
  return text
    .split(CRLF)
    .slice(0, line)
    .reduce((at, one) => at + one.length + 1, 0)
}
export type PreviewMount = (host: HTMLElement, note: PreviewNote) => (() => void) | null
export const previewEditor = Facet.define<PreviewMount, PreviewMount>({
  combine: (values) => values[0] ?? (() => null),
})
const shown = new WeakMap<EditorView, { key: string; create: (view: EditorView) => TooltipView }>()
let asking = false
let locked = false
export const notePreviews = hoverTooltip(
  (view, pos, side): Tooltip | null => {
    if (!modifierHeld() && !asking) return null
    const link = linkAt(view.state, pos)
    if (!link) return null
    if (isTabFile(link.target)) return null
    const index = view.state.facet(noteIndex)
    const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path
    const key = `${path ?? ''} ${link.from} ${link.to} ${linkTarget(link)}`
    const held = shown.get(view)
    const create = held?.key === key ? held.create : cardFor(link, path, side < 0 ? -1 : 1)
    shown.set(view, { key, create })
    return { pos: link.from, end: link.to, above: side < 0, create }
  },
  {
    hoverTime: DELAY,
    hideOn: (transaction) => !locked && (transaction.docChanged || !!transaction.selection),
  },
)
const cardFor =
  (link: LinkSpan, path: string | null, side: -1 | 1) =>
  (view: EditorView): TooltipView => {
    const dom = document.createElement('div')
    dom.className = 'orden-note-preview'
    const name = document.createElement('div')
    name.className = 'orden-note-preview-name'
    name.textContent = linkTarget(link)
    dom.append(name)
    const body = document.createElement('div')
    body.className = 'orden-note-preview-body orden-write'
    body.textContent = 'Loading…'
    followAnchors(body, () => view, true)
    dom.append(body)
    let release: (() => void) | null = null
    const close = () => {
      view.dispatch({ effects: closeHoverTooltip(notePreviews) })
    }
    dom.addEventListener('focusin', () => {
      if (locked) return
      locked = true
      asking = true
      try {
        activateHover(view, link.from, side, {
          tooltip: notePreviews,
          until: (transaction) => transaction.docChanged,
        })
      } finally {
        asking = false
      }
    })
    dom.addEventListener('focusout', (event) => {
      const to = event.relatedTarget
      if (to instanceof Node && dom.contains(to)) return
      close()
    })
    dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      view.focus()
      close()
    })
    if (path === null) {
      body.textContent = 'Note not found'
      return { dom }
    }
    if (view.state.facet(noteIndex).locked?.(path)) {
      body.textContent = 'Protected'
      return { dom }
    }
    const showing = () => body.isConnected
    void view.state
      .facet(noteIndex)
      .read(path)
      .then(async (source) => {
        if (!showing()) return
        const section = source === null ? null : sectionOf(source, link)
        if (source === null || section === null) {
          body.textContent = 'Note not found'
          return
        }
        if (source.length <= MOST_EDITED) {
          const host = document.createElement('div')
          release = view.state.facet(previewEditor)(host, previewNoteOf(view.state, path, source, section, link))
          if (release) {
            body.dataset.written = 'yes'
            body.replaceChildren(host)
            return
          }
        }
        const html = await renderNote(section.slice(0, MOST_PREVIEWED), path, view.state)
        if (showing()) body.innerHTML = html
      })
      .catch(() => {
        if (showing()) body.textContent = 'Note not found'
      })
    return {
      dom,
      destroy: () => {
        release?.()
        release = null
        locked = false
      },
    }
  }
const NAMED_END = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/
const bare = (line: string) => line.replace(NAMED_END, '').trim()
function anchorOf(source: string, section: string): number {
  if (section === source) return 0
  const wanted = section.split('\n').map(bare)
  const lines = source.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  let best = -1
  let most = 0
  for (const [index, line] of lines.entries()) {
    if (!wanted[0] || bare(line) !== wanted[0]) continue
    let same = 1
    while (same < wanted.length && bare(lines[index + same] ?? '') === wanted[same]) same++
    if (same > most) {
      most = same
      best = index
    }
  }
  return best === -1 ? 0 : (starts[best] ?? 0)
}
