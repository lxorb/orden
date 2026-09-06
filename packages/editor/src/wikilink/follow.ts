import { EditorView } from '@codemirror/view'
import { linkTarget, type Wikilink } from '@nib/markdown/links'
import { label } from '../labels'
import { MAC, modifier } from '../links'
import { linkAt } from './at'
import { jumpFor, noteIndex, noteOpener } from './notes'

/** Following a link between notes, and what the link says about itself.
 *
 *  The same gesture web links already have (see links.ts): a plain click puts
 *  the caret where it landed, and the modifier follows the link instead, so
 *  nothing in the text becomes unreachable. Reading mode has no caret to place,
 *  so there a plain click follows. */

/** What a modifier-click on a link will do, in the four wordings that covers:
 *  open it or make it, with the key each platform uses. */
const HOW = {
  open: { mac: 'openNoteMac', other: 'openNote' },
  create: { mac: 'createNoteMac', other: 'createNote' },
} as const

/** The tooltip on a link to a note: where it goes, and what a click will do -
 *  which for a name nothing answers to is to make the note. */
export function noteLinkTitle(link: Wikilink, missing: boolean): string {
  const wording = HOW[missing ? 'create' : 'open']
  return `${linkTarget(link)}\n${label(MAC ? wording.mac : wording.other)}`
}

/** Opens the note a click landed on, if it landed on one. Exported so a test
 *  can follow a link without a pointer. */
export function followNoteAt(view: EditorView, pos: number): boolean {
  const link = linkAt(view.state, pos)
  if (!link) return false

  view.state.facet(noteOpener)(jumpFor(view.state.facet(noteIndex), link, link.kind))
  return true
}

export const noteClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(modifier(event) || view.state.readOnly)) return false

    // An event's target is only an element some of the time, so it is asked
    // rather than assumed - the same reading links.ts does.
    const target = event.target
    const link = target instanceof Element ? target.closest('.nib-link[data-note]') : null
    if (!link) return false

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    event.preventDefault()
    return followNoteAt(view, pos)
  },
})
