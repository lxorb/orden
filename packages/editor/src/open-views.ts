/** Every editor on screen, so a module that arrives late can be put into the ones
 *  already open.
 *
 *  The shape of every lazy extension in this package: a compartment that starts empty,
 *  a library fetched when something asks for it, and then a transaction per open view
 *  to fill the compartment in. The views a fetch has to reach are every view - a pane
 *  each, and two panes may be showing the same note - and nothing else knows them, so
 *  they are kept here and enrolled by an extension each one carries.
 *
 *  One set rather than one per feature: modal editing, the completion menus and
 *  whatever comes next are all asking the same question. See vim.ts and completion.ts.  */

import { EditorView, ViewPlugin } from '@codemirror/view'

const views = new Set<EditorView>()

/** The extension that puts a view on the list, and takes it off again. Carried by
 *  every editor; see `stateExtensions` in editor.ts. */
export const enrolled = ViewPlugin.define((view: EditorView) => {
  views.add(view)

  return {
    destroy() {
      views.delete(view)
    },
  }
})

/** The editors open right now. Iterated rather than handed out as an array: a caller
 *  dispatching into each of them is the only reason anybody asks. */
export function openViews(): Iterable<EditorView> {
  return views
}
