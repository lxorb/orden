import { Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { label } from './labels'

/** Opens a link the reader asked for. The host supplies one that leaves the
 *  app the platform's way; on its own the editor asks the browser. */
export const linkOpener = Facet.define<(href: string) => void, (href: string) => void>({
  combine: (values) => values[0] ?? ((href) => void window.open(href, '_blank', 'noopener')),
})

/** What a link's target is to a browser, or null when it is not one: a
 *  relative path or a `#heading` belongs to the note, not to the web. A bare
 *  `www.` address is how people write a web address without its scheme. */
export function hrefOf(target: string): string | null {
  const trimmed = target.trim()
  if (/^(https?|mailto):/i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The tooltip on a link: where it goes, and how to get there without moving
 *  the caret. */
export function linkTitle(href: string): string {
  return `${href}\n${label(MAC ? 'openLinkMac' : 'openLink')}`
}

function modifier(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey
}

/** A click on a link places the caret, as anywhere else in the text; with the
 *  modifier held it follows the link instead, Typora's way. While the modifier
 *  is down the pointer says so over links. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !modifier(event)) return false

    const target = event.target as HTMLElement | null
    const href = target?.closest?.('.nib-link')?.getAttribute('data-href')
    if (!href) return false

    event.preventDefault()
    view.state.facet(linkOpener)(href)
    return true
  },
  keydown(event, view) {
    if (modifier(event)) view.contentDOM.classList.add('nib-modifier')
    return false
  },
  keyup(event, view) {
    if (!modifier(event)) view.contentDOM.classList.remove('nib-modifier')
    return false
  },
  blur(_event, view) {
    view.contentDOM.classList.remove('nib-modifier')
    return false
  },
})
