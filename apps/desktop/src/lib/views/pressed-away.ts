/** A press past a list's selection lets it go (#1110): anywhere outside its rows and the
 *  bar that acts on them - the list's own room, a head, another pane, a side - clears
 *  what is selected, in a tab's view and in the Tasks panel alike. A press on a row is
 *  the row's to answer (it selects that one, or adds it while some are picked), and a
 *  press in a layer over the list - a menu, the scheduler, a task's sheet - is that
 *  layer's: what the layer does may be to the rows selected. */

import { overlays } from '../overlays'

/** Whether a press at `target` is past the selection of the list `list`, whose own
 *  bar is `bar`. */
export function pressedAway(
  target: EventTarget | null,
  list: Pick<Element, 'contains'> | undefined,
  bar: Pick<Element, 'contains'> | undefined,
): boolean {
  if (overlays.depth > 0) return false
  if (!(target instanceof Element) || !target.isConnected) return false
  if (bar?.contains(target)) return false
  const row = target.closest('[role="option"]')
  return !(row && list?.contains(row))
}

/** Listens for such a press while `on`, and tells `away`; answers the teardown. */
export function hearPressesAway(
  list: () => Pick<Element, 'contains'> | undefined,
  bar: () => Pick<Element, 'contains'> | undefined,
  away: () => void,
): () => void {
  const heard = (event: PointerEvent) => {
    if (pressedAway(event.target, list(), bar())) away()
  }
  window.addEventListener('pointerdown', heard, true)
  return () => window.removeEventListener('pointerdown', heard, true)
}
