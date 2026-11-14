export type Base = 'mine' | 'other' | 'none'

export function baseFor(
  saved: { whose: string | null; mirrors: Record<string, unknown> } | null,
  account: string,
): Base {
  if (!saved || !Object.keys(saved.mirrors).length) return 'none'
  if (saved.whose === null || saved.whose === account) return 'mine'
  return 'other'
}

export function asksOnReturn(base: Base, meets: boolean): boolean {
  return base !== 'mine' && meets
}

export function apartName(name: string, taken: ReadonlySet<string>): string {
  let counter = 2
  while (taken.has(`${name} ${counter}`)) counter += 1
  return `${name} ${counter}`
}
