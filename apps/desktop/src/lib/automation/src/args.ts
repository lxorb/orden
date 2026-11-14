export type Said = Record<string, unknown>

export type Road = 'link' | 'here'

export function words(said: Said, name: string): string | null {
  const value = said[name]
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return null
}

export function said(args: Said, name: string): string | null {
  const value = words(args, name)?.trim()
  return value === undefined || value === '' ? null : value
}

export function yes(args: Said, name: string): boolean {
  const value = args[name]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false

  const folded = value.trim().toLowerCase()
  return folded === '' || folded === 'true' || folded === '1' || folded === 'yes'
}
