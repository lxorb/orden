import type { Heading } from './outline'

function offsetOf(text: string, line: number): number {
  if (line <= 0) return 0

  let at = 0
  for (let count = 0; count < line; count++) {
    const end = text.indexOf('\n', at)
    if (end === -1) return text.length
    at = end + 1
  }

  return at
}

export function sectionSpan(
  text: string,
  headings: readonly Heading[],
  at: number,
): { from: number; to: number } | null {
  const heading = headings[at]
  if (!heading) return null

  const next = headings.findIndex((one, index) => index > at && one.level <= heading.level)

  return {
    from: offsetOf(text, heading.line),
    to: next === -1 ? text.length : offsetOf(text, headings[next]?.line ?? 0),
  }
}

function covers(headings: readonly Heading[], at: number): (index: number) => boolean {
  const heading = headings[at]
  if (!heading) return () => false

  const next = headings.findIndex((one, index) => index > at && one.level <= heading.level)
  const last = next === -1 ? headings.length : next

  return (index) => index >= at && index < last
}

export function movesSection(headings: readonly Heading[], from: number, to: number): boolean {
  if (from === to) return false
  if (!headings[from] || !headings[to]) return false

  return !covers(headings, from)(to)
}

export function moveSection(
  text: string,
  headings: readonly Heading[],
  from: number,
  to: number,
  caret = 0,
): { changes: { from: number; to: number; insert: string }[]; caret: number } | null {
  if (!movesSection(headings, from, to)) return null

  const moving = sectionSpan(text, headings, from)
  const target = sectionSpan(text, headings, to)
  if (!moving || !target) return null

  const body = text.slice(moving.from, moving.to)
  const landing = to > from ? target.to : target.from

  const insert = body.endsWith('\n') ? body : `${body}\n`

  const changes = [
    { from: moving.from, to: moving.to, insert: '' },
    { from: landing, to: landing, insert },
  ]

  const arrivedAt = to > from ? landing - (moving.to - moving.from) : landing
  const inside = caret >= moving.from && caret <= moving.to

  return { changes, caret: inside ? arrivedAt + (caret - moving.from) : caret }
}
