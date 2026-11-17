export type WebData = 'global' | 'space' | 'site'

export const WEB_DATA: readonly WebData[] = ['global', 'space', 'site']

export function isWebData(value: unknown): value is WebData {
  return value === 'global' || value === 'space' || value === 'site'
}

const UNSAFE = /[^a-z0-9.-]/g

const LONGEST = 160

export function siteOf(host: string, registrable: (host: string) => string | null): string {
  return registrable(host) ?? host
}

export function storeName(choice: WebData, space: string, site: string | null): string | null {
  if (choice === 'global') return null

  const id = space.toLowerCase().replace(UNSAFE, '-')
  if (choice === 'space' || !site) return `space_${id}`

  return `site_${id}_${site.toLowerCase().replace(UNSAFE, '-')}`.slice(0, LONGEST)
}
