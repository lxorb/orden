import type { EditorState } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { imageOfFrame, partsOf } from './widget'

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
        const active = view.hasFocus || frame.contains(document.activeElement)
        const selected = !!image && active && isSelected(state, image.from, image.to)

        let flipped = false
        let shift = 0
        if (selected) {
          const box = parts.box.getBoundingClientRect()
          const tools = parts.tools.getBoundingClientRect()
          flipped = box.top - scroller.top < tools.height + 16

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
