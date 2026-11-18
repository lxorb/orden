import { wordRows } from '@orden/markdown/links'

export interface Section {
  index: number
  fraction: number
}

export function sectionAt(position: number, offsets: readonly number[], end: number): Section {
  let index = -1
  for (let one = 0; one < offsets.length; one++) {
    const at = offsets[one]
    if (at === undefined || at > position) break
    index = one
  }

  const from = index < 0 ? 0 : (offsets[index] ?? 0)
  const next = offsets[index + 1] ?? end
  const span = next - from
  const fraction = span > 0 ? Math.min(1, Math.max(0, (position - from) / span)) : 0

  return { index, fraction }
}

export function positionOf(section: Section, offsets: readonly number[], end: number): number {
  const { index, fraction } = section
  const from = index < 0 ? 0 : (offsets[index] ?? 0)
  const next = offsets[index + 1] ?? end

  return Math.round(from + Math.min(1, Math.max(0, fraction)) * Math.max(0, next - from))
}

const ATX = /^ {0,3}#{1,6}(?:\s|$)/

export function headingOffsets(text: string): number[] {
  const found: number[] = []
  for (const row of wordRows(text)) if (ATX.test(row.text)) found.push(row.from)
  return found
}
