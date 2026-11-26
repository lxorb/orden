export const ASIDE = '.orden-moving-'
export const ASIDES: readonly string[] = [ASIDE, '.nib-moving-']
export function isAside(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  return ASIDES.some((aside) => name.startsWith(aside))
}
