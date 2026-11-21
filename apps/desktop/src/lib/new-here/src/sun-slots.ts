import { SLOTS } from './sun-shape'

export interface Lined {
  line: string
}
export interface Slot<Kind extends Lined> {
  line: Kind['line']
  kinds: Kind[]
}
const HOME: Readonly<Record<string, number>> = { notes: 0, chats: 1, terminals: 2, browser: 3 }
const LAST = SLOTS - 1

export function slotsOf<Kind extends Lined>(lines: readonly (readonly Kind[])[]): (Slot<Kind> | null)[] {
  const slots: (Slot<Kind> | null)[] = Array.from({ length: SLOTS }, () => null)
  const homeless: Kind[][] = []
  for (const line of lines) {
    const first = line[0]
    if (!first) continue
    const home = HOME[first.line]
    if (home === undefined || slots[home]) homeless.push([...line])
    else slots[home] = { line: first.line, kinds: [...line] }
  }
  for (const line of homeless) {
    const free = slots.indexOf(null)
    const first = line[0]
    if (!first) continue
    if (free >= 0) slots[free] = { line: first.line, kinds: line }
    else slots[LAST]?.kinds.push(...line)
  }
  return slots
}
export function countsOf<Kind extends Lined>(slots: readonly (Slot<Kind> | null)[]): (number | null)[] {
  return slots.map((slot) => slot?.kinds.length ?? null)
}
