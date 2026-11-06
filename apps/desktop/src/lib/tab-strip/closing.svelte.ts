import { near, type Rect } from './layout'

const TOUCH_HOLD = 2000

export class ClosingWidths {
  widths = $state<ReadonlyMap<string, number> | null>(null)

  private order: readonly string[] = []
  private letGoOfListeners: (() => void) | null = null

  hold(
    widths: ReadonlyMap<string, number>,
    order: readonly string[],
    by: 'mouse' | 'touch',
    rect: () => Rect | null,
    factor: () => number,
  ) {
    if (this.widths) return

    this.widths = widths
    this.order = order

    if (by === 'touch') {
      const timer = setTimeout(() => this.letGo(), TOUCH_HOLD)
      this.letGoOfListeners = () => clearTimeout(timer)
      return
    }

    const moved = (event: PointerEvent) => {
      const box = rect()
      if (!box || !near(box, event.clientX, event.clientY, factor())) this.letGo()
    }
    const left = () => this.letGo()

    window.addEventListener('pointermove', moved)
    document.documentElement.addEventListener('pointerleave', left)
    this.letGoOfListeners = () => {
      window.removeEventListener('pointermove', moved)
      document.documentElement.removeEventListener('pointerleave', left)
    }
  }

  still(order: readonly string[]): boolean {
    if (!this.widths) return false

    let at = 0
    for (const id of order) {
      const found = this.order.indexOf(id, at)
      if (found < 0) {
        this.letGo()
        return false
      }
      at = found + 1
    }

    return true
  }

  letGo() {
    this.letGoOfListeners?.()
    this.letGoOfListeners = null
    this.widths = null
    this.order = []
  }
}
