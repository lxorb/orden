import { Facet } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { jumpForHref, noteIndex, noteOpener } from './wikilink/notes'

export interface LinkPress extends Modified {
  button: number
  shiftKey: boolean
  altKey?: boolean
}
export const linkOpener = Facet.define<
  (href: string, press: LinkPress) => void,
  (href: string, press: LinkPress) => void
>({
  combine: (values) => values[0] ?? ((href) => void window.open(href, '_blank', 'noopener')),
})
export function hrefOf(target: string): string | null {
  const trimmed = target.trim()
  if (/^(https?|mailto):/i.test(trimmed)) return trimmed
  if (/^(orden|nib):\/\/chat\//i.test(trimmed)) return trimmed
  if (/^(orden|nib):\/\/settings\/import\/?$/i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}
const EMAIL = /^[^\s@<>()[\]:/]+@[^\s@<>()[\]/]+\.[^\s@<>()[\]/]+$/
export function bareHref(written: string): string {
  if (/^www\./i.test(written) || /^[a-z][a-z\d+.-]*:/i.test(written)) return written
  return EMAIL.test(written) ? `mailto:${written}` : written
}
const AN_ESCAPE = /\\([!-/:-@[-`{-~])/g
export function linkDestination(written: string): string {
  const trimmed = written.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed.replace(AN_ESCAPE, '$1')
}
const PUNCTUATION = /^[!-/:-@[-`{-~]$/
export function bareTarget(written: string, after: string): string {
  const ends = written.endsWith('\\') && PUNCTUATION.test(after) ? 1 : 0
  return written.slice(0, written.length - ends).replace(AN_ESCAPE, '$1')
}
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
export const linkTitle = (href: string): string =>
  `${href}\n${MAC ? '⌘-click to open the link' : 'Ctrl+Click to open the link'}`
export interface Modified {
  ctrlKey: boolean
  metaKey: boolean
}
export const modifier = (event: Modified): boolean => (MAC ? event.metaKey : event.ctrlKey)
export const modifierHeld = (): boolean => held
let held = false
export const modifierWatch = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      window.addEventListener('keydown', this.watch, true)
      window.addEventListener('keyup', this.watch, true)
      window.addEventListener('blur', this.drop)
    }
    private readonly watch = (event: KeyboardEvent) => {
      held = modifier(event)
      this.mark()
    }
    private readonly drop = () => {
      held = false
      this.mark()
    }
    update() {
      this.mark()
    }
    private mark() {
      this.view.contentDOM.classList.toggle('orden-modifier', held)
    }
    destroy() {
      window.removeEventListener('keydown', this.watch, true)
      window.removeEventListener('keyup', this.watch, true)
      window.removeEventListener('blur', this.drop)
    }
  },
)
const MAIN = 0
const MIDDLE = 1
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const asked = event.button === MIDDLE || (event.button === MAIN && (modifier(event) || view.state.readOnly))
    if (!asked) return false
    const target = event.target
    const link = target instanceof Element ? target.closest('.orden-link') : null
    const href = link?.getAttribute('data-href')
    if (!href) return false
    event.preventDefault()
    view.state.facet(linkOpener)(href, event)
    return true
  },
})
const WEB_ADDRESS = /^[a-z][a-z\d+.-]*:|^\/\//i
function anchorOf(event: Event): Element | null {
  return event.target instanceof Element ? event.target.closest('a[href]') : null
}
function anchorHref(event: Event): string | null {
  return anchorOf(event)?.getAttribute('href') ?? null
}
function followed(view: EditorView, anchor: Element, href: string, event: MouseEvent): boolean {
  const wiki = anchor.classList.contains('wikilink')
  if (!wiki && WEB_ADDRESS.test(href)) {
    view.state.facet(linkOpener)(href, event)
    return true
  }
  const jump = jumpForHref(view.state.facet(noteIndex), href, wiki)
  if (!jump) return false
  view.state.facet(noteOpener)(jump, event)
  return true
}
export function followAnchors(element: HTMLElement, editor: () => EditorView, plain = false) {
  element.addEventListener('mousedown', (event) => {
    const view = editor()
    const asked =
      event.button === MIDDLE || (event.button === MAIN && (plain || modifier(event) || view.state.readOnly))
    const anchor = asked && !event.defaultPrevented ? anchorOf(event) : null
    const href = anchor?.getAttribute('href')
    if (!anchor || !href || !followed(view, anchor, href, event)) return
    event.preventDefault()
    event.stopPropagation()
  })
  for (const type of ['click', 'auxclick']) {
    element.addEventListener(type, (event) => {
      if (anchorHref(event)) event.preventDefault()
    })
  }
}
