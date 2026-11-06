import { overlays } from '../overlays'

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
