import { type EditorView, ViewPlugin, WidgetType } from '@codemirror/view'

export interface Place {
  readonly at: number
}
const places = new WeakMap<EditorView, Set<{ at: number }>>()
export const keptPlaces = ViewPlugin.define(() => ({
  update(update) {
    if (!update.docChanged) return
    for (const place of places.get(update.view) ?? []) place.at = update.changes.mapPos(place.at, 1)
  },
}))

export abstract class OrdenWidget extends WidgetType {
  override destroy(dom: HTMLElement) {
    const undo = TEARDOWN.get(dom)
    TEARDOWN.delete(dom)
    for (const one of undo ?? []) one()
    super.destroy(dom)
  }
  protected place(view: EditorView, dom: HTMLElement, at: number): Place {
    const kept = { at }
    const held = places.get(view) ?? new Set()
    places.set(view, held)
    held.add(kept)
    this.onDestroy(dom, () => held.delete(kept))
    return kept
  }
  protected onDestroy(dom: HTMLElement, undo: () => void) {
    const existing = TEARDOWN.get(dom)
    if (existing) existing.push(undo)
    else TEARDOWN.set(dom, [undo])
  }
}
const TEARDOWN = new WeakMap<HTMLElement, (() => void)[]>()
