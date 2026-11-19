import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll } from 'vitest'

export function noRects() {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
export function keptViews(): EditorView[] {
  const open: EditorView[] = []
  beforeAll(noRects)
  afterEach(() => {
    for (const view of open.splice(0)) view.destroy()
  })
  return open
}
