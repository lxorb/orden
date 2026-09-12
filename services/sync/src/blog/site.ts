/** What the site decides, as against what each note decides.
 *
 *  Publishing a space used to mean publishing every note in it, which is the
 *  right default for a space somebody made to be a blog and the wrong one for
 *  the space somebody already writes in. So a site has rules: folders that are
 *  in, folders that are out, and what happens to a note that says nothing about
 *  itself. A note that does say - `publish: true` or `publish: false` in its
 *  front matter, which is Obsidian Publish's key - always wins, because the note
 *  is the thing the author has in front of them.
 *
 *  The rest of the column is the site's own presence: the description and the
 *  picture its pages fall back on, the icon a tab shows, and a password if it
 *  has one. All of it is one JSON object on the space's row, the way bookmarks,
 *  folder icons, the graph and the excluded paths already are, because every one
 *  of those is read on the same request and a second table would be a second
 *  read per page.
 *
 *  The whole object is written at once. It is short, it is one screen in the
 *  publish sheet, and a PUT of the lot is the only shape in which turning a
 *  password off and a folder on is one request.
 *
 *  What is here is the column and the one decision read off it; the route that
 *  writes it is spaces/site.ts. Two files because the space listing reads this
 *  and the route writes through the listing, and one module cannot be both. */

import type { NoteFront } from './front'
import { PASSWORD_LIMIT } from './gate'

/** More folders than anyone rules on by hand. A vault has hundreds of folders
 *  and a site is a handful of decisions about them; past this it is a site that
 *  wants the other default. */
const MOST_FOLDERS = 100
/** A path inside a space, which is a few folder names. */
const LONGEST_PATH = 300
/** A sentence, for the description every page falls back on. */
const LONGEST_TEXT = 400
/** A theme's name, and a domain beside a counter's script. */
const LONGEST_NAME = 60
/** A URL somebody pasted. */
const LONGEST_URL = 400
/** The icon a tab shows, as the drawing the app made of it. Room for a Lucide
 *  stroke or an emoji drawn as text, and far too little to hide anything in. */
export const LONGEST_ICON = 8 * 1024
/** What the column may grow to. Every field is bounded on its own; this is the
 *  other end of the same guard, so a legal site cannot make the space listing
 *  heavy for every device that reads it. */
export const MOST_BYTES = 24 * 1024

/** What a note that says nothing about itself gets. */
const DEFAULTS = ['all', 'none'] as const
type Otherwise = (typeof DEFAULTS)[number]

export interface SiteRules {
  /** Folders published even where the default is to publish nothing. */
  include: string[]
  /** Folders never published, whatever the default is. */
  exclude: string[]
  /** What a note outside every rule, and silent about itself, gets. */
  otherwise: Otherwise
}

/** How the password is kept.
 *
 *  Hashed with a salt of its own, so the column is not a password. The key is
 *  what the cookie a reader carries is signed with: per site, made when the
 *  password is set, so taking the password off ends every session that was let
 *  in by it. */
export interface SitePassword {
  salt: string
  hash: string
  key: string
  at: number
}

/** What the site is dressed in, where the author chose something other than the
 *  app's own. One of the themes the app itself renders in, by its name in the
 *  registry: the page's stylesheet is generated from the same tokens, so a theme
 *  is a set of colours on both surfaces rather than a second design. */
export interface SiteAnalytics {
  /** The script to load, which is the whole of what Plausible, Umami and
   *  GoatCounter are. */
  url: string
  /** What one or two of them want beside it, as `data-domain`. */
  domain?: string
}

export interface Site {
  rules: SiteRules
  /** The description and the picture a page with none of its own falls back on. */
  description?: string
  image?: string
  /** The icon a tab shows, as an SVG. Drawn by the app, which is the side that
   *  has the icon sets; see docs/publishing.md. */
  icon?: string
  /** The theme the site is dressed in: its name, and the hash of the stylesheet
   *  the app uploaded for it. Absent for the one every page has worn until now,
   *  which is the app's own tokens.
   *
   *  The bytes are a blob rather than a column, because a theme's stylesheet is
   *  tens of kilobytes and the space listing is read on every pass. The page
   *  links it from where every other blob is served; see blog.ts. */
  theme?: { name: string; hash: string }
  /** Where the reader's visit is counted, if the author asked for that. */
  analytics?: SiteAnalytics
  password?: SitePassword
}

const DEFAULT_RULES: SiteRules = { include: [], exclude: [], otherwise: 'all' }

/** A folder path as the space spells it: forward slashes, no leading slash, no
 *  climbing out. The empty string is the space itself, which is a rule about
 *  everything and so is dropped - that is what `otherwise` is for. */
function cleanFolder(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, LONGEST_PATH)
}

export function folders(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const cleaned = value
    .filter((one): one is string => typeof one === 'string')
    .map((one) => cleanFolder(one))
    .filter(Boolean)

  return [...new Set(cleaned)].slice(0, MOST_FOLDERS)
}

export function words(value: unknown, longest = LONGEST_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined

  const said = value.replace(/\s+/g, ' ').trim()
  return said ? said.slice(0, longest) : undefined
}

/** The column, as everything that reads the site reads it. Written whole by the
 *  app, and read field by field here, so a newer client's extra key is ignored
 *  rather than trusted. */
export function readSite(raw: string | null | undefined): Site {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '{}')
  } catch {
    return { rules: DEFAULT_RULES }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { rules: DEFAULT_RULES }
  }

  const held = parsed as Record<string, unknown>
  const given = (held.rules ?? {}) as Record<string, unknown>
  const site: Site = {
    rules: {
      include: folders(given.include),
      exclude: folders(given.exclude),
      otherwise: given.otherwise === 'none' ? 'none' : 'all',
    },
  }

  const description = words(held.description)
  if (description) site.description = description

  const image = words(held.image, 500)
  if (image) site.image = image

  const icon = typeof held.icon === 'string' ? held.icon.slice(0, LONGEST_ICON) : ''
  if (icon.startsWith('<svg')) site.icon = icon

  const theme = held.theme as Record<string, unknown> | undefined
  const themeName = words(theme?.name, LONGEST_NAME)
  const themeHash = words(theme?.hash, 64)
  if (themeName && themeHash && /^[a-f0-9]{64}$/.test(themeHash)) {
    site.theme = { name: themeName, hash: themeHash }
  }

  const analytics = held.analytics as Record<string, unknown> | undefined
  const url = words(analytics?.url, LONGEST_URL)
  if (url && /^https:\/\//i.test(url)) {
    const domain = words(analytics?.domain, LONGEST_NAME)
    site.analytics = { url, ...(domain ? { domain } : {}) }
  }

  const password = held.password as Record<string, unknown> | undefined
  if (
    password &&
    typeof password.salt === 'string' &&
    typeof password.hash === 'string' &&
    typeof password.key === 'string'
  ) {
    site.password = {
      salt: password.salt,
      hash: password.hash,
      key: password.key,
      at: typeof password.at === 'number' ? password.at : 0,
    }
  }

  return site
}

/** Whether a path sits in a folder, or is the folder itself. Case folded,
 *  because a rule somebody typed and a path somebody's disk wrote disagree about
 *  case on two platforms out of three. */
function inside(path: string, folder: string): boolean {
  const one = path.toLowerCase()
  const other = folder.toLowerCase()
  return one === other || one.startsWith(`${other}/`)
}

/** The longest rule that covers a path, so that a folder inside an excluded one
 *  can be included again and the deeper word is the one that counts. */
function longest(path: string, rules: readonly string[]): number {
  let found = -1
  for (const folder of rules)
    if (inside(path, folder) && folder.length > found) found = folder.length
  return found
}

/** Whether the site publishes one note.
 *
 *  The note first: a note that says `publish:` has settled it, and no rule about
 *  a folder overrides what the author wrote in the file. Then the folders, the
 *  deeper rule winning, so `Work` out and `Work/Notes` in reads the way it
 *  sounds. Then the site's default.
 *
 *  Nothing else is consulted. A page is on the site or it is not, and that is one
 *  question with one answer, which is what makes the sheet able to show the list
 *  before anything is published. */
export function publishes(rules: SiteRules, path: string, front: NoteFront): boolean {
  if (front.publish !== undefined) return front.publish

  const held = longest(path, rules.include)
  const kept = longest(path, rules.exclude)

  if (held >= 0 || kept >= 0) return held >= kept

  return rules.otherwise === 'all'
}

/** What the app is told about the site. The password never comes back - only
 *  that there is one - and the icon does, because the sheet shows it. */
export function presentSite(site: Site) {
  return {
    rules: site.rules,
    ...(site.description === undefined ? {} : { description: site.description }),
    ...(site.image === undefined ? {} : { image: site.image }),
    ...(site.icon === undefined ? {} : { icon: site.icon }),
    ...(site.theme === undefined ? {} : { theme: site.theme }),
    ...(site.analytics === undefined ? {} : { analytics: site.analytics }),
    password: !!site.password,
  }
}

/** What is wrong with what arrived, as one sentence, or null. */
export function wrong(body: Record<string, unknown>): string | null {
  const rules = body.rules
  if (rules !== undefined && (!rules || typeof rules !== 'object' || Array.isArray(rules))) {
    return 'rules must be an object'
  }

  if (rules) {
    const given = rules as Record<string, unknown>
    for (const key of ['include', 'exclude'] as const) {
      const value = given[key]
      if (value !== undefined && !Array.isArray(value)) return `${key} must be a list of folders`
      if (Array.isArray(value) && value.length > MOST_FOLDERS) {
        return `${key} holds at most ${MOST_FOLDERS} folders`
      }
    }
    if (given.otherwise !== undefined && !DEFAULTS.some((one) => one === given.otherwise)) {
      return 'otherwise is all or none'
    }
  }

  for (const key of ['description', 'image', 'icon'] as const) {
    const value = body[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${key} must be text`
    }
  }

  if (typeof body.icon === 'string' && body.icon.length > LONGEST_ICON) {
    return 'that icon is too large'
  }

  const theme = body.theme
  if (theme !== undefined && theme !== null) {
    if (typeof theme !== 'object' || Array.isArray(theme)) {
      return 'a theme is a name and the stylesheet it was installed from'
    }

    const held = theme as Record<string, unknown>
    if (typeof held.name !== 'string' || typeof held.hash !== 'string') {
      return 'a theme is a name and the stylesheet it was installed from'
    }
  }

  const analytics = body.analytics
  if (analytics !== undefined && analytics !== null) {
    if (typeof analytics !== 'object' || Array.isArray(analytics)) {
      return 'analytics is a script to load, or null for none'
    }

    const url = (analytics as Record<string, unknown>).url
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return 'an analytics script is an https address'
    }
  }

  const password = body.password
  if (password !== undefined && password !== null && typeof password !== 'string') {
    return 'a password is text, or null to take it off'
  }
  if (typeof password === 'string' && password.length > PASSWORD_LIMIT) {
    return `a password is at most ${PASSWORD_LIMIT} characters`
  }

  return null
}
