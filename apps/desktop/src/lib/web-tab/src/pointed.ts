import { isNumber, isRecord, isString } from '../../platform/src/api'
import type { Rect } from './pages.svelte'

const share = (one: unknown): one is number => isNumber(one) && one >= 0 && one <= 1

export function pointedAt(
  said: unknown,
  placed: (tab: string) => Rect | null,
): { clientX: number; clientY: number } | null {
  if (!isRecord(said) || !isString(said.tab) || !share(said.x) || !share(said.y)) return null
  const box = placed(said.tab)
  return box && { clientX: box.x + said.x * box.width, clientY: box.y + said.y * box.height }
}

export function pointerMoved(said: unknown, placed: (tab: string) => Rect | null): void {
  const at = pointedAt(said, placed)
  if (at) window.dispatchEvent(new PointerEvent('pointermove', { ...at, pointerType: 'mouse' }))
}
