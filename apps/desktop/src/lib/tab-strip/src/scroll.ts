export function revealed(
  at: number,
  page: number,
  length: number,
  start: number,
  end: number,
): number {
  const nearest = start < at ? start : end > at + page ? end - page : at
  return Math.min(Math.max(nearest, 0), Math.max(length - page, 0))
}
