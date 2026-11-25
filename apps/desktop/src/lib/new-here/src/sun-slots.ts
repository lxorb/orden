import { SLOTS } from './sun-shape'

export interface Lined {
  line: string
}
export interface Slot<Kind extends Lined> {
  line: Kind['line']
  kinds: Kind[]
}
const HOME: Readonly<Record<string, number>> = { notes: 0, chats: 1, terminals: 2, browser: 3 }

export function slotsOf<Kind extends Lined>(lines: readonly (readonly Kind[])[]): Slot<Kind>[] {
  const homed: (Slot<Kind> | null)[] = Array.from({ length: SLOTS }, () => null)
  const homeless: Slot<Kind>[] = []
  for (const line of lines) {
    const first = line[0]
    if (!first) continue
    const home = HOME[first.line]
    const slot = { line: first.line, kinds: [...line] }
    if (home === undefined || homed[home]) homeless.push(slot)
    else homed[home] = slot
  }
  const slots = [...homed.filter((one): one is Slot<Kind> => one !== null), ...homeless]
  const kept = slots.slice(0, SLOTS)
  for (const extra of slots.slice(SLOTS)) kept[SLOTS - 1]?.kinds.push(...extra.kinds)
  return kept
}
export function countsOf<Kind extends Lined>(slots: readonly Slot<Kind>[]): number[] {
  return slots.map((slot) => slot.kinds.length)
}
