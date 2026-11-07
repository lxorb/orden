import { isWebAddress } from './web-address'

const SECTION = 'internetshortcut'

const URL_KEY = 'url'

const TITLE_KEY = 'title'
const ADDED_KEY = 'orden-added'
const HOME_KEY = 'orden-home'
const ICON_KEY = 'orden-icon'
const DATA_KEY = 'orden-data'
const CHOSEN_KEY = 'orden-chosen-icon'
const CHOSEN_COLOUR_KEY = 'orden-chosen-color'
const FORMER = /^nib-(?=[a-z])/

const OWN = /^[0-9a-f]{16}$/

const WEBLOC_URL = /(?<=<key>\s*URL\s*<\/key>\s*<string>)[\s\S]*?(?=<\/string>)/i

export interface Shortcut {
  url: string
  title: string | null
  added: string | null
  home: string | null
  icon: string | null
  own: string | null
  chosen: string | null
  chosenColour: string | null
}

export function writeShortcut(
  url: string,
  title: string,
  when: Date,
  home?: string | null,
  icon?: string | null,
  own?: string | null,
): string {
  return shortcutText({ url, title, when, home, icon, own, chosen: null, chosenColour: null })
}

export function rewriteShortcut(
  was: Shortcut,
  change: Partial<Omit<Shortcut, 'added'>> & { when?: Date },
  fallbackTitle = '',
): string {
  const next = { ...was, ...change }
  const added = was.added ? new Date(was.added) : new Date()
  return shortcutText({
    url: next.url,
    title: next.title ?? fallbackTitle,
    when: change.when ?? (Number.isNaN(added.getTime()) ? new Date() : added),
    home: next.home,
    icon: next.icon,
    own: next.own,
    chosen: next.chosen,
    chosenColour: next.chosen === null ? null : next.chosenColour,
  })
}

function shortcutText(parts: {
  url: string
  title: string
  when: Date
  home?: string | null | undefined
  icon?: string | null | undefined
  own?: string | null | undefined
  chosen: string | null
  chosenColour: string | null
}): string {
  const { url, title, when, home, icon, own, chosen, chosenColour } = parts
  const rows = [
    `URL=${oneLine(url)}`,
    `Title=${oneLine(title.trim() || url)}`,
    `Orden-Added=${when.toISOString()}`,
  ]

  if (home && home !== url) rows.push(`Orden-Home=${oneLine(home)}`)
  if (icon) rows.push(`Orden-Icon=${oneLine(icon)}`)
  if (own && OWN.test(own)) rows.push(`Orden-Data=${own}`)
  if (chosen) rows.push(`Orden-Chosen-Icon=${oneLine(chosen)}`)
  if (chosen && chosenColour) rows.push(`Orden-Chosen-Color=${oneLine(chosenColour)}`)

  return `[InternetShortcut]\r\n${rows.join('\r\n')}\r\n`
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function readShortcut(text: string | null | undefined): Shortcut | null {
  if (!text) return null

  let section = ''
  const said = new Map<string, string>()
  const fresh = new Set<string>()

  for (const row of text.split('\n')) {
    const line = row.trim()
    if (line.length === 0 || line.startsWith(';') || line.startsWith('#')) continue

    const named = /^\[(.*)]$/.exec(line)
    if (named) {
      section = (named[1] ?? '').trim().toLowerCase()
      continue
    }

    if (section !== SECTION) continue

    const at = line.indexOf('=')
    if (at < 1) continue

    const written = line.slice(0, at).trim().toLowerCase()
    const key = written.replace(FORMER, 'orden-')
    const former = key !== written
    if (said.has(key) && (former || fresh.has(key))) continue
    said.set(key, line.slice(at + 1).trim())
    if (!former) fresh.add(key)
  }

  const url = said.get(URL_KEY) ?? ''
  if (!isWebAddress(url)) return null

  return {
    url,
    title: nothing(said.get(TITLE_KEY)),
    added: nothing(said.get(ADDED_KEY)),
    home: nothing(said.get(HOME_KEY)),
    icon: nothing(said.get(ICON_KEY)),
    own: ownOf(said.get(DATA_KEY)),
    chosen: nothing(said.get(CHOSEN_KEY)),
    chosenColour: nothing(said.get(CHOSEN_COLOUR_KEY)),
  }
}

function ownOf(value: string | undefined): string | null {
  const said = value?.trim().toLowerCase() ?? ''
  return OWN.test(said) ? said : null
}

function nothing(value: string | undefined): string | null {
  const said = value?.trim() ?? ''
  return said.length === 0 ? null : said
}

export function readWebFile(path: string, text: string | null | undefined): Shortcut | null {
  if (!/\.webloc$/i.test(path.trim())) return readShortcut(text)

  const url = readWebloc(text)
  return url === null
    ? null
    : {
        url,
        title: null,
        added: null,
        home: null,
        icon: null,
        own: null,
        chosen: null,
        chosenColour: null,
      }
}

export function apartOf(tab: {
  path: string | null
  doc: string
  apart?: string | null
}): string | null {
  return tab.path === null ? (tab.apart ?? null) : (readWebFile(tab.path, tab.doc)?.own ?? null)
}

export function readWebloc(text: string | null | undefined): string | null {
  if (!text) return null

  const found = WEBLOC_URL.exec(text)
  const url = entities((found?.[0] ?? '').trim())
  return isWebAddress(url) ? url : null
}

export function aimWebloc(text: string, url: string): string {
  return text.replace(WEBLOC_URL, () => escaped(url))
}

function escaped(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function entities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
