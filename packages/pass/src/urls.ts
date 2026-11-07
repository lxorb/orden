import { getDomain } from 'tldts'
import type { Website } from './types'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function urlOf(text: string): URL | null {
  const trimmed = text.trim()
  if (trimmed === '' || (!SCHEME.test(trimmed) && OTHER_SCHEME.test(trimmed))) return null
  try {
    const url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== ''
      ? url
      : null
  } catch {
    return null
  }
}

export function normalizeUrl(text: string): string | null {
  return urlOf(text)?.href ?? null
}

export function hostOf(url: string): string | null {
  return urlOf(url)?.hostname ?? null
}

function siteOfHost(host: string): string {
  if (host.startsWith('[') || IPV4.test(host) || host === 'localhost') return host
  return getDomain(host, { allowPrivateDomains: true }) ?? host
}

export function siteOf(url: string): string | null {
  const host = hostOf(url)
  return host === null ? null : siteOfHost(host)
}

function pathOf(url: URL): string {
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export function matches(website: Website, pageUrl: string): boolean {
  if (website.match === 'never') return false
  const site = urlOf(website.url)
  const page = urlOf(pageUrl)
  if (site === null || page === null) return false
  if (site.protocol === 'https:' && page.protocol !== 'https:') return false
  if (site.port !== page.port) return false
  switch (website.match) {
    case 'domain':
      return siteOfHost(site.hostname) === siteOfHost(page.hostname)
    case 'host':
      return site.hostname === page.hostname
    case 'exact':
      return pathOf(site) === pathOf(page)
    case 'prefix':
      return page.href.startsWith(site.href)
  }
}

export function rank(website: Website, pageUrl: string): number {
  if (!matches(website, pageUrl)) return 0
  switch (website.match) {
    case 'exact':
      return 5
    case 'prefix':
      return 4
    case 'host':
      return 3
    case 'domain':
    case 'never':
      return hostOf(website.url) === hostOf(pageUrl) ? 2 : 1
  }
}

export function isSecurePage(url: string): boolean {
  let page: URL
  try {
    page = new URL(url)
  } catch {
    return false
  }
  if (page.protocol === 'https:') return true
  if (page.protocol !== 'http:') return false
  const host = page.hostname
  return (
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
  )
}
