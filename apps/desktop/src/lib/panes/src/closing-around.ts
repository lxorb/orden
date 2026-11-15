export type Around = 'others' | 'right' | 'all'

export function closedAround<T extends { readonly id: string }>(
  strip: readonly T[],
  id: string,
  which: Around,
): T[] {
  const at = strip.findIndex((one) => one.id === id)
  if (at < 0) return []

  return which === 'all'
    ? [...strip]
    : which === 'right'
      ? strip.slice(at + 1)
      : strip.filter((one) => one.id !== id)
}

export function closeAfterLabel(): string {
  return 'Close tabs to the right'
}
