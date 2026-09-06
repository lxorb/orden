import { caretLine, type EditorView, showLine, topLine } from '@nib/editor'
import { untrack } from 'svelte'
import { workspace } from './workspace.svelte'

/** Where a note was being read, put back when it opens and written down as it
 *  moves. A crash gives no chance to record it on the way out, so it is
 *  recorded as it happens instead. */
class Placement {
  /** The tab whose caret and scroll have been put back. Nothing is recorded
   *  before that, or a fresh view's caret at 0 would overwrite the real one.
   *
   *  Deliberately not `$state`: nothing renders from it, and `follow` both
   *  writes it and reads it back. As reactive state that is a cycle, and Svelte
   *  answers a cycle by tearing down the whole render loop - which looked like
   *  tabs that only switched after a reload. */
  private placed: string | null = null

  /** Asks for the place of the tab on show to be written down at the next
   *  frame. Set by `follow`, which owns the measurement; not reactive, for the
   *  same reason `placed` is not. */
  private soon: (() => void) | null = null

  /** What the editor calls when the selection moves. Nothing to do before a
   *  view has been placed. */
  remember() {
    this.soon?.()
  }

  /** Puts the tab's place into `view` and keeps it up to date until the view
   *  goes. `path` is the note the tab is on now: a preview tab moves on to
   *  another note without becoming another tab, so what is recorded has to be
   *  checked against the note it was measured for.
   *
   *  Answers the teardown, so the effect that calls this can hand it straight
   *  back to Svelte. */
  follow(view: EditorView, id: string, path: string | null): () => void {
    const tab = untrack(() => workspace.tabs.find((one) => one.id === id))
    const cursor = untrack(() => tab?.cursor ?? 0)
    const top = untrack(() => tab?.scroll ?? 0)
    const anchor = untrack(() => tab?.anchor)

    const record = () => {
      if (this.placed !== id) return
      // What the view shows belongs to the note the tab is on now; if that is
      // no longer this one, this run has nothing true to say about it.
      const now = untrack(() => workspace.tabs.find((one) => one.id === id)?.path ?? null)
      if (now !== path) return

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
    this.soon = soon

    // Placed once a frame has laid the note out: the caret needs the text to
    // be in, the offset needs a height, and a view that has just been made
    // has neither. Recording starts only then, so nothing gets written down
    // about a view that is still settling.
    const frame = requestAnimationFrame(() => {
      const at = Math.min(cursor, view.state.doc.length)
      view.dispatch({ selection: { anchor: at } })

      // The line that was at the top goes back to the top. Only a session
      // written by an older build has no line, and keeps its pixel offset -
      // with one more pass after the measure, since the estimate can put the
      // same offset on a different line.
      if (anchor === undefined) {
        view.scrollDOM.scrollTop = top
        view.requestMeasure({
          read: () => null,
          write: () => {
            if (this.placed === id) view.scrollDOM.scrollTop = top
          },
        })
      } else {
        showLine(view, anchor)
      }

      this.placed = id
      view.scrollDOM.addEventListener('scroll', soon, { passive: true })
    })

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(scheduled)
      view.scrollDOM.removeEventListener('scroll', soon)
      // A view that has already left the page reads as scrolled to the top,
      // which is not where the note was: what was recorded as it moved stands.
      if (view.scrollDOM.isConnected) record()
      this.placed = null
      if (this.soon === soon) this.soon = null
    }
  }
}

export const placement = new Placement()
