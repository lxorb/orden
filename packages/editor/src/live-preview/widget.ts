import { WidgetType } from '@codemirror/view'

export abstract class OrdenWidget extends WidgetType {
  override destroy(dom: HTMLElement) {
    const undo = TEARDOWN.get(dom)
    TEARDOWN.delete(dom)
    for (const one of undo ?? []) one()
    super.destroy(dom)
  }

  protected onDestroy(dom: HTMLElement, undo: () => void) {
    const existing = TEARDOWN.get(dom)
    if (existing) existing.push(undo)
    else TEARDOWN.set(dom, [undo])
  }
}

const TEARDOWN = new WeakMap<HTMLElement, (() => void)[]>()
