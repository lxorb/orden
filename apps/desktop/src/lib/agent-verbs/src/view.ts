import { tabOverview, workspace } from '../../workspace/src/api'

interface View {
  space: string | null
  focused: string
  shown: readonly (readonly [string, string | null])[]
  overview: boolean
  focus: Element | null
}
let readerActs = 0
let hearing = false
const slipped = new Set<(verb: string) => void>()
function hearReader(): void {
  if (hearing || typeof window === 'undefined') return
  hearing = true
  for (const kind of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(
      kind,
      (event) => {
        if (event.isTrusted) readerActs += 1
      },
      { capture: true, passive: true },
    )
  }
}
function viewNow(): View | null {
  try {
    return {
      space: workspace.activeSpace?.id ?? null,
      focused: workspace.panes.focusedId,
      shown: workspace.panes.all.map((pane) => [pane.id, pane.activeTabId] as const),
      overview: tabOverview.open,
      focus: typeof document === 'undefined' ? null : document.activeElement,
    }
  } catch {
    return null
  }
}
function focusMoved(before: View): boolean {
  return before.focus !== null && before.focus.isConnected && document.activeElement !== before.focus
}
function moved(before: View | null, after: View | null): before is View {
  if (before === null || after === null) return false
  return (
    before.space !== after.space ||
    before.focused !== after.focused ||
    before.overview !== after.overview ||
    before.shown.some(([pane, tab]) => after.shown.some(([id, now]) => id === pane && now !== tab)) ||
    focusMoved(before)
  )
}
async function putBack(view: View): Promise<void> {
  if (view.space !== null && workspace.activeSpace?.id !== view.space) await workspace.showSpace(view.space)
  for (const [pane, tab] of view.shown) workspace.panes.activate(pane, tab)
  workspace.focusPane(view.focused)
  tabOverview.open = view.overview
  if (focusMoved(view) && view.focus instanceof HTMLElement) view.focus.focus({ preventScroll: true })
}
export async function keepingView<T>(verb: string, run: () => Promise<T>): Promise<T> {
  hearReader()
  const before = viewNow()
  const acts = readerActs
  try {
    return await run()
  } finally {
    if (readerActs === acts && moved(before, viewNow())) {
      for (const hear of slipped) hear(verb)
      await putBack(before)
    }
  }
}
export function onViewSlip(hear: (verb: string) => void): () => void {
  slipped.add(hear)
  return () => void slipped.delete(hear)
}
