export interface Looked {
  readonly id: string
  readonly look: string | null
}

export function twins(tabs: readonly Looked[]): Set<string> {
  const seen = new Map<string, number>()
  for (const one of tabs) if (one.look !== null) seen.set(one.look, (seen.get(one.look) ?? 0) + 1)
  return new Set(
    tabs.filter((one) => one.look !== null && (seen.get(one.look) ?? 0) > 1).map((one) => one.id),
  )
}

export function siteLook(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    return `web:${new URL(address).host}`
  } catch {
    return null
  }
}
