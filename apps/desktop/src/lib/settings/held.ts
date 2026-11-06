const instead = new Map<string, ((value: unknown) => unknown)[]>()

export function sendInstead(key: string, fix: (value: unknown) => unknown): void {
  instead.set(key, [...(instead.get(key) ?? []), fix])
}

export function sendAsSaid(): void {
  instead.clear()
}

export function shareable<T extends object>(patch: T): T {
  if (!instead.size) return patch
  const sent = { ...patch } as Record<string, unknown>
  for (const [key, fixes] of instead) {
    if (key in sent) sent[key] = fixes.reduce((value, fix) => fix(value), sent[key])
  }
  return sent as T
}
