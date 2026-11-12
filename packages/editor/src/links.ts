import { Facet } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

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

const AN_ESCAPE = /\\([!-/:-@[-`{-~])/g

const PUNCTUATION = /^[!-/:-@[-`{-~]$/

export function bareTarget(written: string, after: string): string {
  const ends = written.endsWith('\\') && PUNCTUATION.test(after) ? 1 : 0
  return written.slice(0, written.length - ends).replace(AN_ESCAPE, '$1')
}

export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function linkTitle(href: string): string {
  return `${href}\n${MAC ? '⌘-click to open the link' : 'Ctrl+Click to open the link'}`
}

export interface Modified {
  ctrlKey: boolean
  metaKey: boolean
}

export function modifier(event: Modified): boolean {
  return MAC ? event.metaKey : event.ctrlKey
}

export function modifierHeld(): boolean {
  return held
}

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
    const asked =
      event.button === MIDDLE || (event.button === MAIN && (modifier(event) || view.state.readOnly))
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
