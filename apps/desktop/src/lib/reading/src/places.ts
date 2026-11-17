import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'

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

function frontMatterEnd(text: string): number {
  return frontMatterBlock(text)?.to ?? 0
}

const ATX = /^ {0,3}#{1,6}(?:\s|$)/

export function headingOffsets(text: string): number[] {
  const found: number[] = []
  const code = new CodeBlocks()
  let at = frontMatterEnd(text)

  for (;;) {
    const end = text.indexOf('\n', at)
    const line = text.slice(at, end === -1 ? text.length : end)

    if (code.line(line) === WORDS && ATX.test(line)) found.push(at)

    if (end === -1) return found
    at = end + 1
  }
}
