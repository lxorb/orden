import { type EditorState, Facet } from '@codemirror/state'
import {
  activateHover,
  closeHoverTooltip,
  type EditorView,
  hoverTooltip,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { isTabFile, linkTarget, sectionOf } from '@orden/markdown/links'
import { label } from '../labels'
import { modifierHeld } from '../links'
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

export const previewNoteOf = (
  state: EditorState,
  path: string,
  text: string,
  section: string,
): PreviewNote => ({ path, text, at: anchorOf(text, section), readOnly: state.readOnly })

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

function cardFor(link: LinkSpan, path: string | null, side: -1 | 1) {
  return (view: EditorView): TooltipView => {
    const dom = document.createElement('div')
    dom.className = 'nib-note-preview'

    const name = document.createElement('div')
    name.className = 'nib-note-preview-name'
    name.textContent = linkTarget(link)
    dom.append(name)

    const body = document.createElement('div')
    body.className = 'nib-note-preview-body nib-write'
    body.textContent = label('loadingNote')
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
      body.textContent = label('noteNotFound')
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
          body.textContent = label('noteNotFound')
          return
        }

        if (source.length <= MOST_EDITED) {
          const host = document.createElement('div')
          release = view.state.facet(previewEditor)(
            host,
            previewNoteOf(view.state, path, source, section),
          )

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
        if (showing()) body.textContent = label('noteNotFound')
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
}

function anchorOf(source: string, section: string): number {
  if (section === source) return 0

  const first = section.split('\n')[0] ?? ''
  const at = first ? source.indexOf(first) : -1
  return at === -1 ? 0 : at
}
