const FORMER = 'x-nib-'

export function said(
  read: (name: string) => string | null | undefined,
  name: string,
): string | undefined {
  return read(`x-orden-${name}`) ?? read(`${FORMER}${name}`) ?? undefined
}

export const SAID = (names: readonly string[]): string[] =>
  names.flatMap((name) => [`x-orden-${name}`, `${FORMER}${name}`])
