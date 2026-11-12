import { documentTitle, noteWithoutComments, withoutComments } from '@orden/markdown'
import { frontMatterList, frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { findLinks } from '@orden/markdown/links'
import { objectIn } from '../body'

const LONGEST_TEXT = 400
const LONGEST_PATH = 200
const MOST_ALIASES = 10
const MOST_TAGS = 40
const MOST_LINKS = 200
const LONGEST_SUMMARY = 300

export interface NoteFront {
  publish?: boolean
  permalink?: string
  aliases?: string[]
  title?: string
  description?: string
  image?: string
  date?: string
  heading?: string
  summary?: string
  order?: number
  tags?: string[]
  links?: string[]
}

function flag(value: string | null): boolean | undefined {
  if (value === null) return undefined

  const word = value.trim().toLowerCase()
  if (word === 'true' || word === 'yes') return true
  if (word === 'false' || word === 'no') return false

  return undefined
}

function cleanSlug(value: string): string {
  const parts = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^\p{L}\p{M}\p{N}/_-]+/gu, '-')
    .split('/')
    .map((part) => part.replace(/^-+|-+$/g, ''))
    .filter((part) => part && part !== '.' && part !== '..')

  return parts.join('/').normalize('NFC').slice(0, LONGEST_PATH)
}

function text(value: string | null, longest = LONGEST_TEXT): string | undefined {
  const said = value?.replace(/\s+/g, ' ').trim() ?? ''
  return said ? said.slice(0, longest) : undefined
}

function firstWords(source: string): string | undefined {
  const body = stripFrontMatter(source)
  let words = ''
  let fenced = false

  for (const line of body.split(/\r?\n/)) {
    const said = line.trim()

    if (/^(```|~~~)/.test(said)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    if (!said) {
      if (words) break
      continue
    }

    if (/^(#{1,6}\s|>|\||-{3,}|\*{3,}|!\[)/.test(said)) {
      if (words) break
      continue
    }

    words = words ? `${words} ${said}` : said
    if (words.length >= LONGEST_SUMMARY) break
  }

  if (!words) return undefined

  const plain = words
    .replace(/!?\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plain ? plain.slice(0, LONGEST_SUMMARY) : undefined
}

export function frontOf(written: string): NoteFront | null {
  const source = noteWithoutComments(written)
  const front: NoteFront = {}

  const publish = flag(frontMatterValue(source, 'publish'))
  if (publish !== undefined) front.publish = publish

  const permalink = frontMatterValue(source, 'permalink')
  const slug = permalink ? cleanSlug(permalink) : ''
  if (slug) front.permalink = slug

  const aliases = frontMatterList(source, 'aliases')
    .map((one) => cleanSlug(one))
    .filter(Boolean)
    .slice(0, MOST_ALIASES)
  if (aliases.length) front.aliases = [...new Set(aliases)]

  const title = text(frontMatterValue(source, 'title'))
  if (title) front.title = title

  const description = text(frontMatterValue(source, 'description'))
  if (description) front.description = description

  const image = text(frontMatterValue(source, 'image') ?? frontMatterValue(source, 'cover'), 500)
  if (image) front.image = image

  const date = text(frontMatterValue(source, 'date'), 40)
  if (date) front.date = date

  const heading = text(documentTitle(source), 200)
  if (heading) front.heading = heading

  const said = frontMatterValue(source, 'order')?.trim()
  const order = said ? Number(said) : Number.NaN
  if (Number.isFinite(order)) front.order = order

  const tags = frontMatterList(source, 'tags')
    .map((one) => one.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MOST_TAGS)
  if (tags.length) front.tags = [...new Set(tags)]

  const links = [
    ...new Set(
      findLinks(source)
        .filter((one) => !one.embed && one.target)
        .map((one) => one.target.replace(/\\/g, '/').toLowerCase().slice(0, LONGEST_PATH)),
    ),
  ].slice(0, MOST_LINKS)
  if (links.length) front.links = links

  const summary = firstWords(source)
  if (summary) front.summary = summary

  return Object.keys(front).length ? front : null
}

export function readFront(raw: string | null): NoteFront {
  const held = objectIn(raw)
  if (!held) return {}
  const front: NoteFront = {}

  if (typeof held.publish === 'boolean') front.publish = held.publish
  if (typeof held.permalink === 'string') front.permalink = held.permalink.slice(0, LONGEST_PATH)
  if (Array.isArray(held.aliases)) {
    const aliases = held.aliases
      .filter((one): one is string => typeof one === 'string')
      .map((one) => one.slice(0, LONGEST_PATH))
      .slice(0, MOST_ALIASES)
    if (aliases.length) front.aliases = aliases
  }
  for (const key of ['title', 'description', 'image', 'date', 'heading', 'summary'] as const) {
    const value = held[key]
    if (typeof value === 'string' && value) front[key] = value.slice(0, LONGEST_TEXT)
  }

  const uncommented = (value: string | undefined) =>
    value === undefined
      ? undefined
      : withoutComments(value).replace(/\s+/g, ' ').trim() || undefined
  const heading = uncommented(front.heading)
  const summary = uncommented(front.summary)
  delete front.heading
  delete front.summary
  if (heading) front.heading = heading
  if (summary) front.summary = summary

  if (typeof held.order === 'number' && Number.isFinite(held.order)) front.order = held.order

  for (const key of ['tags', 'links'] as const) {
    const value = held[key]
    if (!Array.isArray(value)) continue

    const kept = value
      .filter((one): one is string => typeof one === 'string' && !!one)
      .map((one) => one.slice(0, LONGEST_PATH))
      .slice(0, key === 'tags' ? MOST_TAGS : MOST_LINKS)
    if (kept.length) front[key] = kept
  }

  return front
}

function titleIn(path: string, front: NoteFront): string {
  return (
    front.title ??
    front.heading ??
    path
      .replace(/\.(md|markdown|mdown|mkd)$/i, '')
      .split('/')
      .pop() ??
    path
  )
}

export function titleFrom(path: string, source: string): string {
  return titleIn(path, frontOf(source) ?? {})
}

export const FRONT_REV = 2

export function writeFront(source: string): string {
  return JSON.stringify(frontOf(source) ?? {})
}
