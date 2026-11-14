import { readable } from '@orden/scan/web-address'
import type { Visit } from './visits'

const TYPED_WEIGHT = 10

const DAY = 24 * 60 * 60 * 1000

const OFFERED = 5

export function frecency(visit: Visit, now: number): number {
  const days = (now - visit.last) / DAY
  const recent = days < 4 ? 1 : days < 14 ? 0.7 : days < 31 ? 0.5 : days < 90 ? 0.3 : 0.1

  return (visit.visits + visit.typed * TYPED_WEIGHT) * recent
}

interface Parts {
  protocol: string
  host: string
  bare: string
  hostShown: string
  bareShown: string
  path: string
  words: string
}

const taken = new WeakMap<Visit, Parts>()

function split(address: string): Omit<Parts, 'words'> {
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

function partsOf(visit: Visit): Parts {
  const known = taken.get(visit)
  if (known) return known

  const said = split(visit.url)
  const shown = said.bareShown === said.bare ? '' : ` ${said.bareShown}`
  const parts = {
    ...said,
    words: `${said.bare}${said.path}${shown} ${visit.title}`.toLowerCase().normalize('NFC'),
  }

  taken.set(visit, parts)
  return parts
}

export function shownAddress(url: string): string {
  const { protocol, bareShown, path } = split(url)
  const shown = `${bareShown}${path === '/' ? '' : path}`

  return protocol === 'http:' ? `http://${shown}` : shown
}

export interface Completion {
  text: string
  url: string
}

const SCHEME = /^(https?):\/\//i

export function completion(list: readonly Visit[], typed: string, now: number): Completion | null {
  const said = typed.trimStart()
  if (!said || /\s/.test(said)) return null

  const scheme = SCHEME.exec(said)
  const rest = scheme ? said.slice(scheme[0].length) : said
  if (!rest) return null

  const asked = rest.toLowerCase().normalize('NFC')
  const protocol = scheme ? `${(scheme[1] ?? '').toLowerCase()}:` : null
  const pastHost = /[/?#]/.test(rest)

  let best: { score: number; form: string; url: string } | null = null
  const sites = new Map<string, { score: number; form: string; url: string }>()

  for (const visit of list) {
    const parts = partsOf(visit)
    if (protocol !== null && parts.protocol !== protocol) continue

    if (pastHost) {
      const form = [parts.bareShown, parts.hostShown, parts.bare, parts.host]
        .map((one) => `${one}${parts.path}`)
        .find((one) => one.toLowerCase().startsWith(asked))
      if (form === undefined) continue

      const score = frecency(visit, now)
      if (!best || score > best.score) best = { score, form, url: visit.url }
      continue
    }

    const form = [parts.bareShown, parts.hostShown, parts.bare, parts.host].find((one) =>
      one.startsWith(asked),
    )
    if (form === undefined) continue

    const site = `${parts.protocol}//${parts.host}`
    const was = sites.get(site)
    sites.set(site, {
      score: (was?.score ?? 0) + frecency(visit, now),
      form,
      url: `${site}/`,
    })
  }

  for (const site of sites.values()) {
    if (!best || site.score > best.score) best = site
  }

  return best ? { text: `${said}${best.form.slice(asked.length)}`, url: best.url } : null
}

const HOST_START = 4

function found(parts: Parts, term: string): number {
  const hosts = [parts.bareShown, parts.hostShown, parts.bare, parts.host]
  if (hosts.some((one) => one.startsWith(term))) return HOST_START

  let at = parts.words.indexOf(term)
  let anywhere = false
  while (at !== -1) {
    const before = parts.words[at - 1] ?? ' '
    if (!/[\p{L}\p{N}]/u.test(before)) return 2
    anywhere = true
    at = parts.words.indexOf(term, at + 1)
  }

  return anywhere && term.length > 2 ? 1 : 0
}

export function suggested(
  list: readonly Visit[],
  typed: string,
  now: number,
  count = OFFERED,
): Visit[] {
  const terms = typed
    .trim()
    .replace(SCHEME, '')
    .toLowerCase()
    .normalize('NFC')
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return []

  const scored: { visit: Visit; site: boolean; score: number }[] = []
  for (const visit of list) {
    const parts = partsOf(visit)

    let how = 1
    for (const term of terms) {
      how *= found(parts, term)
      if (how === 0) break
    }

    if (how === 0) continue

    const site = found(parts, terms[0] ?? '') === HOST_START
    scored.push({ visit, site, score: how * frecency(visit, now) })
  }

  return scored
    .sort(
      (one, other) =>
        Number(other.site) - Number(one.site) ||
        other.score - one.score ||
        one.visit.url.length - other.visit.url.length,
    )
    .slice(0, count)
    .map((one) => one.visit)
}
