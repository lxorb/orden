import { hoverTooltip, type Tooltip } from '@codemirror/view'
import { isPdfTarget, linkTarget, sectionOf } from '@nib/markdown/links'
import { label } from '../labels'
import { modifierHeld } from '../links'
import { linkAt } from './at'
import { noteIndex, resolveLink } from './notes'
import { renderNote } from './preview'

/** The note behind a link, while the modifier is held over it.
 *
 *  Held rather than merely hovered because the pointer crosses a link on its way
 *  to anywhere: a popup that opened on its own would keep appearing over the
 *  words being read. It is the same key that turns a click into a jump, so
 *  holding it is already "I mean this link", and the preview is what that shows.
 *
 *  Only links between notes. A web address has nothing to preview that is not a
 *  page load, and loading a stranger's page because a pointer passed over it is
 *  not something a note editor should do. */

/** How long the pointer rests before the note is read. Long enough that reading
 *  past a link costs nothing, short enough to feel like an answer. */
const DELAY = 300

/** How much of a note the popover shows. It is a glance, not the note. */
const MOST_PREVIEWED = 4000

export const notePreviews = hoverTooltip(
  (view, pos, side): Tooltip | null => {
    // CodeMirror reports a hover as a position and not as the event behind it,
    // so whether the key is down has to be asked of links.ts, which watches it
    // for the pointer already. One place decides what "held" means.
    // CodeMirror reports a hover as a position and not as the event behind it,
    // so whether the key is down is asked of links.ts, which watches it for the
    // pointer already. One place decides what "held" means.
    if (!modifierHeld()) return null

    const link = linkAt(view.state, pos)
    if (!link) return null
    // A PDF has no markdown to show in a popover, and rendering its bytes as
    // words would be worse than showing nothing.
    if (isPdfTarget(link.target)) return null

    const index = view.state.facet(noteIndex)
    const path = link.target ? (resolveLink(index, link, link.kind)?.path ?? null) : index.path

    return {
      pos: link.from,
      end: link.to,
      above: side < 0,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'nib-note-preview'

        const name = document.createElement('div')
        name.className = 'nib-note-preview-name'
        name.textContent = linkTarget(link)
        dom.append(name)

        const body = document.createElement('div')
        body.className = 'nib-note-preview-body'
        body.textContent = label('loadingNote')
        dom.append(body)

        if (path === null) {
          body.textContent = label('noteNotFound')
          return { dom }
        }

        void index
          .read(path)
          .then((source) => {
            if (!body.isConnected) return
            const section = source === null ? null : sectionOf(source, link)
            if (section === null) {
              body.textContent = label('noteNotFound')
              return
            }
            body.innerHTML = renderNote(section.slice(0, MOST_PREVIEWED), view)
          })
          .catch(() => {
            if (body.isConnected) body.textContent = label('noteNotFound')
          })

        return { dom }
      },
    }
  },
  // Gone as soon as the document or the caret moves: a preview is about the
  // link the pointer is on, and typing means the writer has moved on.
  { hoverTime: DELAY, hideOnChange: true },
)
