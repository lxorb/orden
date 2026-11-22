export interface Span {
  top: number
  bottom: number
}
export interface Pool {
  live: number[]
  playing: number[]
}
const BEHIND = 1
const AHEAD = 2
const KEPT = 3
const shown = (span: Span, height: number) => span.bottom > 0 && span.top < height
const within = (span: Span, height: number, behind: number, ahead: number) =>
  span.bottom > span.top && span.bottom > -behind * height && span.top < height + ahead * height
function distance(span: Span, height: number): number {
  const off = Math.max(0, span.top - height, -span.bottom)
  return off * 4 + Math.abs((span.top + span.bottom) / 2 - height / 2)
}
export function poolOf(spans: readonly Span[], height: number, most: number, held: readonly number[] = []): Pool {
  const ranked = spans
    .map((span, index) => ({ index, span, far: distance(span, height) }))
    .sort((a, b) => a.far - b.far)
  const near = ranked.filter(({ span }) => within(span, height, BEHIND, AHEAD))
  const kept = ranked.filter(
    ({ index, span }) =>
      held.includes(index) && !near.some((one) => one.index === index) && within(span, height, KEPT, KEPT + 1),
  )
  const live = [...near, ...kept].slice(0, Math.max(0, most))
  return {
    live: live.map(({ index }) => index),
    playing: live.filter(({ span }) => shown(span, height)).map(({ index }) => index),
  }
}
