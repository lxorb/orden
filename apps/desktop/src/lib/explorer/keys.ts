export function stepped(
  key: string,
  at: number | null,
  count: number,
  columns: number,
  page: number,
): number | null {
  if (count <= 0) return null
  const last = count - 1
  const clamp = (to: number) => Math.min(last, Math.max(0, to))
  switch (key) {
    case 'ArrowDown':
      return at === null ? 0 : clamp(at + columns)
    case 'ArrowUp':
      return at === null ? last : clamp(at - columns)
    case 'ArrowRight':
      return columns > 1 ? (at === null ? 0 : clamp(at + 1)) : null
    case 'ArrowLeft':
      return columns > 1 ? (at === null ? 0 : clamp(at - 1)) : null
    case 'Home':
      return 0
    case 'End':
      return last
    case 'PageDown':
      return clamp((at ?? -1) + page * columns)
    case 'PageUp':
      return clamp((at ?? 0) - page * columns)
    default:
      return null
  }
}
