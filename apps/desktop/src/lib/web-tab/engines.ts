import { isWebAddress } from './address'
import { SEARCH, WORDS } from './typed'

export interface Engine {
  id: string
  name: string
  url: string
}

const EVERYWHERE: readonly Engine[] = [
  { id: 'google', name: 'Google', url: SEARCH },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?query=%s' },
  { id: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
  { id: 'yahoo', name: 'Yahoo!', url: 'https://search.yahoo.com/search?p=%s' },
]

const REGIONAL: Readonly<Record<string, readonly Engine[]>> = {
  zh: [
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query=%s' },
    { id: 'so', name: '360', url: 'https://www.so.com/s?q=%s' },
  ],
  ja: [{ id: 'yahoo-jp', name: 'Yahoo! JAPAN', url: 'https://search.yahoo.co.jp/search?p=%s' }],
  ko: [
    { id: 'naver', name: 'NAVER', url: 'https://search.naver.com/search.naver?query=%s' },
    { id: 'daum', name: 'Daum', url: 'https://search.daum.net/search?q=%s' },
  ],
  ru: [{ id: 'yandex', name: 'Яндекс', url: 'https://yandex.ru/search/?text=%s' }],
}

export function enginesFor(language: string): readonly Engine[] {
  const base = language.toLowerCase().split('-')[0] ?? ''
  return [...EVERYWHERE, ...(REGIONAL[base] ?? [])]
}

const ALL: readonly Engine[] = [...EVERYWHERE, ...Object.values(REGIONAL).flat()]

export function engineById(id: string): Engine | null {
  return ALL.find((one) => one.id === id) ?? null
}

export function engineHome(search: string): string {
  return rootOf(search) ?? rootOf(SEARCH) ?? SEARCH
}

function rootOf(search: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(search.trim())
  } catch {
    return null
  }

  const root = `${parsed.origin}/`
  return isWebAddress(root) ? root : null
}

export function isEngineAddress(url: string): boolean {
  const said = url.trim()
  return said.includes(WORDS) && isWebAddress(said.replaceAll(WORDS, 'orden'))
}

export function engineFor(name: string | null, search: string | null): Engine | null {
  const called = name?.trim().toLowerCase()
  const named = called ? ALL.find((one) => one.name.toLowerCase() === called) : undefined
  if (named) return named

  const site = search ? siteOf(search) : null
  return site === null ? null : (ALL.find((one) => siteOf(one.url) === site) ?? null)
}

function siteOf(search: string): string | null {
  try {
    return new URL(search.replaceAll(WORDS, 'orden')).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
