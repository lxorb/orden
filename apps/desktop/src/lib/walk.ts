export function walked(key: string, at: number | null, count: number, wrap = false): number | null {
  if (count <= 0) return null

  switch (key) {
    case 'ArrowDown':
      if (at === null) return 0
      return at + 1 < count ? at + 1 : wrap ? 0 : at
    case 'ArrowUp':
      if (at === null) return count - 1
      return at > 0 ? at - 1 : wrap ? count - 1 : at
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
