import { Facet } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
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

/** Read from the user agent string rather than `navigator.platform`, which is
 *  deprecated, and from the string rather than `userAgentData`, which only
 *  Chromium has. All this decides is whether the modifier is Cmd or Ctrl. */
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** The tooltip on a link: where it goes, and how to get there without moving
 *  the caret. */
export function linkTitle(href: string): string {
  return `${href}\n${label(MAC ? 'openLinkMac' : 'openLink')}`
}

/** Whether the key that turns a click into a jump is down. Exported because
 *  links between notes are followed the same way; see wikilink/follow.ts. */
export function modifier(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey
}

/** Whether the modifier is being held right now.
 *
 *  A value of its own rather than something read back off the `nib-modifier`
 *  class below, because that class does not survive: CodeMirror writes the
 *  content element's `class` attribute out from its own facets on every update,
 *  and takes any class added by hand with it. */
export function modifierHeld(): boolean {
  return held
}

let held = false

/** Watches the modifier, and marks the writing surface while it is down so the
 *  pointer can turn into a hand over a link.
 *
 *  On the window rather than on the editor, because which key is held is a fact
 *  about the keyboard: the editor loses focus for all sorts of reasons - a
 *  click in the sidebar, a panel opening, a re-render - and a reader holding the
 *  key has not stopped holding it because of any of them. Watched from a plugin
 *  rather than at import time, so the listeners live exactly as long as a view
 *  does. */
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

    /** Put back after every update, which is when CodeMirror rewrites the
     *  attribute this lives in. A no-op when it is already right. */
    update() {
      this.mark()
    }

    private mark() {
      this.view.contentDOM.classList.toggle('nib-modifier', held)
    }

    destroy() {
      window.removeEventListener('keydown', this.watch, true)
      window.removeEventListener('keyup', this.watch, true)
      window.removeEventListener('blur', this.drop)
    }
  },
)

/** A click on a link places the caret, as anywhere else in the text; with the
 *  modifier held it follows the link instead, Typora's way. What the pointer
 *  looks like while the key is down is `modifierWatch` above.
 *
 *  Reading mode has no caret to place, so there the plain click is not
 *  ambiguous and follows the link, the way it would on a page. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(modifier(event) || view.state.readOnly)) return false

    // An event's target is only an element some of the time - a click can land
    // on a text node - so it is asked rather than assumed.
    const target = event.target
    const link = target instanceof Element ? target.closest('.nib-link') : null
    const href = link?.getAttribute('data-href')
    if (!href) return false

    event.preventDefault()
    view.state.facet(linkOpener)(href)
    return true
  },
})
