export interface Span {
  top: number
  bottom: number
}
export interface Pool {
  live: number[]
  playing: number[]
}
const NEAR = 0.6
const shown = (span: Span, height: number) => span.bottom > 0 && span.top < height
function distance(span: Span, height: number): number {
  const off = Math.max(0, span.top - height, -span.bottom)
  return off * 4 + Math.abs((span.top + span.bottom) / 2 - height / 2)
}
export function poolOf(spans: readonly Span[], height: number, most: number): Pool {
  const near = height * NEAR
  const chosen = spans
    .map((span, index) => ({ index, seen: shown(span, height), far: distance(span, height), span }))
    .filter(({ span }) => span.bottom > span.top && span.bottom > -near && span.top < height + near)
    .sort((a, b) => a.far - b.far)
    .slice(0, Math.max(0, most))
    .sort((a, b) => a.index - b.index)
  return {
    live: chosen.map(({ index }) => index),
    playing: chosen.filter(({ seen }) => seen).map(({ index }) => index),
  }
}
