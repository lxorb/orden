import { isWebAddress, readable } from './web-address'

const LONGEST_ADDRESS = 2048

const TYPED_WEIGHT = 10

const DAY = 24 * 60 * 60 * 1000

export interface Visit {
  url: string
  title: string
  visits: number
  typed: number
  last: number
}

export function visitKey(url: string): string | null {
  if (url.length > LONGEST_ADDRESS || !isWebAddress(url)) return null

  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

export function frecency(visit: Visit, now: number): number {
  const days = (now - visit.last) / DAY
  const recent = days < 4 ? 1 : days < 14 ? 0.7 : days < 31 ? 0.5 : days < 90 ? 0.3 : 0.1

  return (visit.visits + visit.typed * TYPED_WEIGHT) * recent
}

export interface AddressParts {
  protocol: string
  host: string
  bare: string
  hostShown: string
  bareShown: string
  path: string
}

export function addressParts(address: string): AddressParts {
  const url = new URL(address)
  const host = url.host.toLowerCase()
  const hostShown = readable(host)

  return {
    protocol: url.protocol,
    host,
    bare: host.replace(/^www\./, ''),
    hostShown,
    bareShown: hostShown.replace(/^www\./, ''),
    path: `${url.pathname}${url.search}`,
  }
}

export function shownAddress(url: string): string {
  const { protocol, bareShown, path } = addressParts(url)
  const shown = `${bareShown}${path === '/' ? '' : path}`

  return protocol === 'http:' ? `http://${shown}` : shown
}

export function hostOf(url: string | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname || null
  } catch {
    return null
  }
}
