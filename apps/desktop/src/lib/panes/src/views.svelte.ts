import { documentOf, type DocView, type EditorView, type SharedDoc } from '@orden/editor'
import { SvelteMap } from 'svelte/reactivity'

class Views {
  private readonly held = new SvelteMap<string, EditorView>()

  onSelection: ((view: EditorView) => void) | null = null

  onPut: ((paneId: string, view: EditorView) => void) | null = null

  of(paneId: string): EditorView | undefined {
    return this.held.get(paneId)
  }

  put(paneId: string, view: EditorView) {
    this.held.set(paneId, view)
    this.onPut?.(paneId, view)
  }

  forget(paneId: string) {
    const gone = this.held.get(paneId)
    this.held.delete(paneId)
    if (!gone || gone !== this.reporting) return

    this.reporting = null
    this.chosen = 0
  }

  chosen = $state(0)

  private reporting: EditorView | null = null

  selectedText(): string {
    const view = this.reporting
    if (!view) return ''

    return view.state.selection.ranges
      .filter((one) => !one.empty)
      .map((one) => view.state.doc.sliceString(one.from, one.to))
      .join('\n')
  }

  selectedIn(): SharedDoc | null {
    return this.reporting ? documentOf(this.reporting) : null
  }

  moved(view: EditorView) {
    this.reporting = view
    this.chosen = view.state.selection.ranges.reduce((sum, one) => sum + (one.to - one.from), 0)
    this.onSelection?.(view)
  }
}

export const views = new Views()

export interface ShownTab {
  readonly id: string
  readonly paneId: string
  readonly note: { readonly live: SharedDoc }
}

export function viewShowing<V extends DocView>(
  tab: ShownTab,
  viewOf: (paneId: string) => V | null | undefined,
): V | null {
  const view = viewOf(tab.paneId)
  return view && documentOf(view) === tab.note.live ? view : null
}

export class WhenShown<V extends DocView> {
  private waiting: { tab: string; act: (view: V) => void } | null = null

  constructor(
    private readonly find: (tabId: string) => ShownTab | undefined,
    private readonly viewOf: (paneId: string) => V | null | undefined,
  ) {}

  run(tab: ShownTab, act: (view: V) => void): boolean {
    const view = viewShowing(tab, this.viewOf)
    this.waiting = view ? null : { tab: tab.id, act }
    if (view) act(view)
    return view !== null
  }

  settle() {
    const asked = this.waiting
    this.waiting = null
    const tab = asked && this.find(asked.tab)
    const view = tab ? viewShowing(tab, this.viewOf) : null
    if (asked && view) asked.act(view)
  }
}
