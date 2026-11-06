const RUNS = new Set(['javascript:', 'vbscript:'])

export function absolute(value: string, base?: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

export function runsCode(address: URL): boolean {
  return RUNS.has(address.protocol)
}
