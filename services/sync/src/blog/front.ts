/** What a note says about its own page.
 *
 *  A published page is the note, so the note is where the page's decisions live:
 *  whether it is on the site at all, where it sits, what else finds it, and what
 *  a search result or a shared link shows. Obsidian Publish's own keys, because a
 *  vault should move between the two without being rewritten - `publish`,
 *  `permalink`, `aliases`, `description`, `image` (or `cover`), `date`.
 *
 *  Read once, when the note is written, and kept on the row: the site has to
 *  decide about every note in a space to answer one request, and the bodies are
 *  in R2. The first words ride along for the same reason - a feed of twenty
 *  entries would otherwise be twenty reads out of storage.
 *
 *  Nothing here is a setting. A note that says nothing about itself has no row
 *  to speak of, and what happens to it is the site's default; see
 *  spaces/site.ts. */

import { documentTitle } from '@nib/markdown'
import { frontMatterList, frontMatterValue, stripFrontMatter } from '@nib/markdown/front-matter'

/** Long enough for a sentence somebody wrote as a description, short enough that
 *  the column cannot be used as storage. */
const LONGEST_TEXT = 400
/** A path inside a site: a few words and some slashes. */
const LONGEST_PATH = 200
/** More aliases than a page has reasons to have. */
const MOST_ALIASES = 10
/** What a feed entry shows of a page that gave no description. Two lines. */
const LONGEST_SUMMARY = 300

export interface NoteFront {
  /** What the note says about being published, or absent where it says nothing -
   *  which is the only state the site's default applies to. */
  publish?: boolean
  /** Where the page sits, instead of where its path would put it. */
  permalink?: string
  /** Other paths that find this page. */
  aliases?: string[]
  /** The page's own title, where the note names one rather than opening with a
   *  heading. */
  title?: string
  /** The page's description, for the tags and for the feed. */
  description?: string
  /** The picture a shared link shows. */
  image?: string
  /** What the feed orders by, where the note says. */
  date?: string
  /** The heading the note opens with, which is what its page is called when it
   *  names no title. Not front matter; it comes out of the same read, and it is
   *  here so that a list of a thousand pages needs none of their bodies. */
  heading?: string
  /** The first words of the note, for a feed entry and for a description
   *  nobody wrote. Not front matter; it comes out of the same read. */
  summary?: string
}

/** `true`, `false`, and the two words YAML reads as those. Anything else is a
 *  note saying something we do not understand, which is a note saying nothing:
 *  the site's default decides, rather than a typo taking a page down. */
function flag(value: string | null): boolean | undefined {
  if (value === null) return undefined

  const word = value.trim().toLowerCase()
  if (word === 'true' || word === 'yes') return true
  if (word === 'false' || word === 'no') return false

  return undefined
}

/** One path inside the site, as the site spells paths: lower case, no leading or
 *  trailing slash, no `..`, one slash between parts. Anything left over after
 *  that is not a path and is dropped. */
export function cleanSlug(value: string): string {
  const parts = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .split('/')
    .map((part) => part.replace(/^-+|-+$/g, ''))
    .filter((part) => part && part !== '.' && part !== '..')

  return parts.join('/').slice(0, LONGEST_PATH)
}

function text(value: string | null, longest = LONGEST_TEXT): string | undefined {
  const said = value?.replace(/\s+/g, ' ').trim() ?? ''
  return said ? said.slice(0, longest) : undefined
}

/** The first paragraph of a note, as one line.
 *
 *  What a reader would read first, which is what a feed entry and a search result
 *  want. The heading is skipped: a title above a description that repeats it is
 *  the same words twice. Everything that is markup for something - a fence, a
 *  quote, a picture, a table - is passed over rather than shown as the characters
 *  it is written with. */
export function firstWords(source: string): string | undefined {
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

    // A heading, a rule, a quote, a list, a table, a picture on its own, or a
    // property block's fence: none of those is the sentence being looked for.
    if (/^(#{1,6}\s|>|\||-{3,}|\*{3,}|!\[)/.test(said)) {
      if (words) break
      continue
    }

    words = words ? `${words} ${said}` : said
    if (words.length >= LONGEST_SUMMARY) break
  }

  if (!words) return undefined

  // The marks that make words bold or linked are not part of the words.
  const plain = words
    .replace(/!?\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plain ? plain.slice(0, LONGEST_SUMMARY) : undefined
}

/** Everything a note says about its page, from the note. Null where it says
 *  nothing at all, which is most notes, so most rows keep nothing. */
export function frontOf(source: string): NoteFront | null {
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

  // Obsidian Publish reads `image`; a good many themes write `cover` for the
  // same thing, and a vault that has one rarely has both.
  const image = text(frontMatterValue(source, 'image') ?? frontMatterValue(source, 'cover'), 500)
  if (image) front.image = image

  const date = text(frontMatterValue(source, 'date'), 40)
  if (date) front.date = date

  const heading = text(documentTitle(source), 200)
  if (heading) front.heading = heading

  const summary = firstWords(source)
  if (summary) front.summary = summary

  return Object.keys(front).length ? front : null
}

/** The column, as everything downstream reads it. A row written by a newer
 *  version may hold a key this one has never heard of, so every field is checked
 *  on the way out rather than trusted. */
export function readFront(raw: string | null): NoteFront {
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const held = parsed as Record<string, unknown>
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

  return front
}

/** What goes in the column.
 *
 *  Always a string, `{}` for a note that says nothing about itself, so that null
 *  in the column means one thing only: nobody has read this note's head yet. That
 *  is the question `fillFronts` below asks, and a sentinel is what keeps it from
 *  reading the same silent note out of storage every night.
 *
 *  Note that a null front and an empty one are the same answer to every reader:
 *  see `readFront`. */
export function writeFront(source: string): string {
  return JSON.stringify(frontOf(source) ?? {})
}
