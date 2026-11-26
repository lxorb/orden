export function said(read: (name: string) => string | null | undefined, name: string): string | undefined {
  return read(`x-orden-${name}`) ?? undefined
}
export const SAID = (names: readonly string[]): string[] => names.map((name) => `x-orden-${name}`)
export function tokenIn(header: string | undefined): string | null {
  const token = /^bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim()
  return token ?? null
}
