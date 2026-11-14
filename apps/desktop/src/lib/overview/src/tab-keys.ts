export interface Keyed {
  id: string
  kind: string
  path: string | null
  shown: string
  inPrivate?: boolean
}

export function lastingKeys(tabs: readonly Keyed[]): Map<string, string> {
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const tab of tabs) {
    if (tab.inPrivate) continue
    const base = `${tab.kind}:${tab.path ?? `~${tab.shown}`}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    out.set(tab.id, nth ? `${base}#${nth}` : base)
  }
  return out
}
