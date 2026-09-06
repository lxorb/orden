import type { EditorState } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { imageOfFrame, partsOf } from './widget'

/** Keeping every frame's classes in step with the selection.
 *
 *  A plugin rather than part of the widget, because the widget is rebuilt when
 *  what it draws changes and a click changes nothing about the picture. Marking
 *  the selection from outside means clicking a picture never rebuilds the toolbar
 *  that was just clicked.
 *
 *  Reads happen in the measure phase and writes after it, the way the editor
 *  asks: the toolbar flips below the picture when the picture is too close to
 *  the top of the view for it to fit above, and slides sideways when it would
 *  otherwise hang off the edge, and both of those are answers to where things
 *  are on screen. */

function isSelected(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from === from && range.to === to)
}

interface Mark {
  frame: HTMLElement
  selected: boolean
  flipped: boolean
  shift: number
}

export const imageSelection = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.schedule()
    }

    update(update: ViewUpdate) {
      if (
        update.selectionSet ||
        update.docChanged ||
        update.viewportChanged ||
        update.focusChanged ||
        update.geometryChanged
      ) {
        this.schedule()
      }
    }

    private schedule() {
      this.view.requestMeasure({
        key: this,
        read: () => this.read(),
        write: (marks: Mark[]) => {
          for (const { frame, selected, flipped, shift } of marks) {
            frame.classList.toggle('is-selected', selected)
            frame.classList.toggle('is-flipped', flipped)
            frame.style.setProperty('--nib-tools-shift', `${shift}px`)
          }
        },
      })
    }

    private read(): Mark[] {
      const view = this.view
      const state = view.state
      const scroller = view.scrollDOM.getBoundingClientRect()
      const out: Mark[] = []

      for (const frame of view.contentDOM.querySelectorAll<HTMLElement>('.nib-image-frame')) {
        const parts = partsOf(frame)
        if (!parts) continue

        const image = imageOfFrame(view, frame)
        // The selection is only shown while it is the editor's, or while the
        // toolbar - part of showing it - holds focus.
        const active = view.hasFocus || frame.contains(document.activeElement)
        const selected = !!image && active && isSelected(state, image.from, image.to)

        let flipped = false
        let shift = 0
        if (selected) {
          const box = parts.box.getBoundingClientRect()
          const tools = parts.tools.getBoundingClientRect()
          flipped = box.top - scroller.top < tools.height + 16

          // Centred on the picture, but kept inside the view.
          const current = parseFloat(frame.style.getPropertyValue('--nib-tools-shift')) || 0
          const left = tools.left - current
          const right = left + tools.width
          const margin = 8
          if (left < scroller.left + margin) shift = scroller.left + margin - left
          else if (right > scroller.right - margin) shift = scroller.right - margin - right
        }

        out.push({ frame, selected, flipped, shift })
      }

      return out
    }
  },
)
