import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

const setDragging = StateEffect.define<boolean>()

/** True while a selection is being dragged out with the mouse.
 *
 *  Revealing syntax as the selection moves would reflow the line under the
 *  pointer mid-drag: `**bold**` growing by four characters shifts everything
 *  after it, and the selection ends somewhere nobody pointed at. So the reveal
 *  state holds still until the button comes back up. */
export const dragging = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDragging)) return effect.value
    }
    return value
  },
})

/** Watches the mouse. The release is listened for on the window, because a
 *  drag very often ends past the edge of the editor - and because CodeMirror
 *  listens on the document. On mouseup it reads the pointer position one last
 *  time and moves the caret there, so the reveal has to wait until that read is
 *  done: revealing first reflows the line and the final read lands the caret a
 *  character or two from where the click was. Window listeners run after
 *  document listeners, whatever order they were added in. */
const watcher = ViewPlugin.fromClass(
  class {
    private readonly release: () => void

    constructor(private readonly view: EditorView) {
      this.release = () => this.end()
      window.addEventListener('mouseup', this.release)
      // A drag interrupted by the window losing focus never gets a mouseup.
      window.addEventListener('blur', this.release)
      // Neither does a selection or an image carried off as a drag and drop:
      // the browser stops sending mouse events once the drag begins, and
      // says so with dragend instead.
      window.addEventListener('dragend', this.release)
    }

    destroy() {
      window.removeEventListener('mouseup', this.release)
      window.removeEventListener('blur', this.release)
      window.removeEventListener('dragend', this.release)
    }

    private end() {
      if (this.view.state.field(dragging, false)) {
        this.view.dispatch({ effects: setDragging.of(false) })
      }
    }
  },
  {
    eventHandlers: {
      mousedown(event: MouseEvent, view: EditorView) {
        // Only the button that draws a selection.
        if (event.button !== 0) return false
        view.dispatch({ effects: setDragging.of(true) })
        return false
      },
    },
  },
)

export const dragFreeze = [dragging, watcher]
