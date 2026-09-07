import { caretLine, type EditorView, sharedOf, topLine } from '@nib/editor'
import { untrack } from 'svelte'
import { workspace } from './workspace.svelte'

/** Where a note is being read, written down as it moves. A crash gives no chance
 *  to record it on the way out, so it is recorded as it happens instead.
 *
 *  Only the writing down. Putting a place back is not done here: it belongs to
 *  the state the pane swaps in, so a note appears already where it was left
 *  rather than arriving at its top and being moved a frame later. See
 *  editor-states.ts and held.ts.
 *
 *  One entry per view, because a note open in two panes is being read in two
 *  places: each pane keeps its own caret and its own place in the note, and the
 *  tab is what those belong to. */
class Placement {
  /** What each view on the page asks for when its selection moves. Deliberately
   *  not `$state`: nothing renders from it, and `follow` both writes it and
   *  reads it back, which as reactive state is a cycle - and Svelte answers a
   *  cycle by tearing down the whole render loop. */
  private readonly pending = new Map<EditorView, () => void>()

  /** What the editor calls when the selection moves. Nothing to do before a view
   *  has been placed. */
  remember(view: EditorView) {
    this.pending.get(view)?.()
  }

  /** Keeps the tab's place up to date until the pane moves on. `path` is the note
   *  the tab is on now: a preview tab moves on to another note without becoming
   *  another tab, so what is recorded has to be checked against the note it was
   *  measured for.
   *
   *  Answers the teardown, so the effect that calls this can hand it straight
   *  back to Svelte. */
  follow(view: EditorView, id: string, path: string | null): () => void {
    /** Nothing is recorded until the note has settled into the view. The offset a
     *  view reports before CodeMirror has measured it and scrolled it is the top
     *  of the note, which is not where the note is. */
    let placed = false

    const record = () => {
      if (!placed) return

      const tab = untrack(() => workspace.tabs.find((one) => one.id === id))
      // What the view shows belongs to the note the tab is on now; if that is
      // no longer this one, this run has nothing true to say about it. A preview
      // tab takes another note on without becoming another tab, and the pane's
      // view may already have swapped this note out for the next one.
      if (tab?.path !== path || sharedOf(view.state) !== tab.note.live) return

      workspace.noteView(
        id,
        view.state.selection.main.head,
        view.scrollDOM.scrollTop,
        topLine(view),
        caretLine(view),
      )
    }

    // `topLine` measures the view, and a measurement taken straight after the
    // editor has written to the DOM makes the browser lay the document out
    // again there and then - on every keystroke, over a document that may be
    // thousands of lines. Once a frame instead: by then the layout is the one
    // on screen, and a burst of keystrokes asks for it once.
    let scheduled = 0
    const soon = () => {
      if (scheduled) return
      scheduled = requestAnimationFrame(() => {
        scheduled = 0
        record()
      })
    }
    this.pending.set(view, soon)

    const settled = requestAnimationFrame(() => {
      placed = true
    })
    view.scrollDOM.addEventListener('scroll', soon, { passive: true })

    return () => {
      cancelAnimationFrame(settled)
      cancelAnimationFrame(scheduled)
      view.scrollDOM.removeEventListener('scroll', soon)
      // A view that has already left the page reads as scrolled to the top,
      // which is not where the note was: what was recorded as it moved stands.
      if (view.scrollDOM.isConnected) record()
      placed = false
      this.pending.delete(view)
    }
  }
}

export const placement = new Placement()
