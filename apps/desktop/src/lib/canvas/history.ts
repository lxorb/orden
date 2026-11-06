import type { Canvas } from './format'

export const KEPT = 60

export class CanvasHistory {
  private past: Canvas[] = []
  private future: Canvas[] = []

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  record(before: Canvas) {
    this.past.push(before)
    if (this.past.length > KEPT) this.past.shift()
    this.future = []
  }

  undo(current: Canvas): Canvas | null {
    const before = this.past.pop()
    if (!before) return null

    this.future.unshift(current)
    return before
  }

  redo(current: Canvas): Canvas | null {
    const after = this.future.shift()
    if (!after) return null

    this.past.push(current)
    return after
  }

  clear() {
    this.past = []
    this.future = []
  }
}
