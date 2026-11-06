import { caretLine, documentOf, type EditorView, foldLines, topLine } from '@orden/editor'
import { untrack } from 'svelte'
import { onceAFrame } from './timing'
import { type Tab, workspace } from './workspace.svelte'

class Placement {
  private readonly pending = new Map<EditorView, () => void>()

  remember(view: EditorView) {
    this.pending.get(view)?.()
  }

  follow(view: EditorView, showing: Tab): () => void {
    const id = showing.id
    const path = showing.path
    const live = showing.note.live
    const arrivals = showing.note.arrivals

    let placed = false

    const record = () => {
      if (!placed) return

      const tab = untrack(() => workspace.tabs.find((one) => one.id === id))
      if (tab?.path !== path || tab.note.arrivals !== arrivals) return
      if (documentOf(view) !== live) return

      workspace.noteView(
        id,
        view.state.selection.main.head,
        view.scrollDOM.scrollTop,
        topLine(view),
        caretLine(view),
        foldLines(view.state),
      )
    }

    const soon = onceAFrame(record)
    this.pending.set(view, soon)

    const settled = requestAnimationFrame(() => {
      placed = true
    })
    view.scrollDOM.addEventListener('scroll', soon, { passive: true })

    return () => {
      cancelAnimationFrame(settled)
      soon.cancel()
      view.scrollDOM.removeEventListener('scroll', soon)
      placed = false
      this.pending.delete(view)
    }
  }
}

export const placement = new Placement()
