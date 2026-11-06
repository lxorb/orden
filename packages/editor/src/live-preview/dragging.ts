import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

export const setDragging = StateEffect.define<boolean>()

export const dragging = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDragging)) return effect.value
    }
    return value
  },
})

export function dragsSelection(button: number, pointer: string): boolean {
  return button === 0 && pointer === 'mouse'
}

const watcher = ViewPlugin.fromClass(
  class {
    private readonly release: () => void
    pointer = 'mouse'

    constructor(private readonly view: EditorView) {
      this.release = () => this.end()
      window.addEventListener('mouseup', this.release)
      window.addEventListener('blur', this.release)
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
      pointerdown(event: PointerEvent) {
        this.pointer = event.pointerType || 'mouse'
        return false
      },
      mousedown(event: MouseEvent, view: EditorView) {
        if (!dragsSelection(event.button, this.pointer)) return false
        view.dispatch({ effects: setDragging.of(true) })
        return false
      },
    },
  },
)

export const dragFreeze = [dragging, watcher]
