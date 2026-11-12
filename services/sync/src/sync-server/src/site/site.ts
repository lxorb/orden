import { objectIn } from '../body'
import type { NoteFront } from './front'
import { PASSWORD_LIMIT } from './gate'

const MOST_FOLDERS = 100
const LONGEST_PATH = 300
const LONGEST_TEXT = 400
const LONGEST_NAME = 60
const LONGEST_URL = 400
export const LONGEST_ICON = 8 * 1024

export const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

const DEFAULTS = ['all', 'none'] as const
type Otherwise = (typeof DEFAULTS)[number]

export interface SiteRules {
  include: string[]
  exclude: string[]
  otherwise: Otherwise
}

export interface SitePassword {
  salt: string
  hash: string
  key: string
  at: number
}

interface SiteAnalytics {
  url: string
  domain?: string
}

export interface Site {
  rules: SiteRules
  description?: string
  image?: string
  icon?: string
  theme?: { name: string; hash: string }
  analytics?: SiteAnalytics
  password?: SitePassword
}

const DEFAULT_RULES: SiteRules = { include: [], exclude: [], otherwise: 'all' }

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

function isCounterUrl(url: string | undefined): url is string {
  return url !== undefined && /^https:\/\//i.test(url) && URL.canParse(url)
}

export function readSite(raw: string | null | undefined): Site {
  const held = objectIn(raw)
  if (!held) return { rules: DEFAULT_RULES }

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
  if (isCounterUrl(url)) {
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

function inside(path: string, folder: string): boolean {
  const one = path.toLowerCase()
  const other = folder.toLowerCase()
  return one === other || one.startsWith(`${other}/`)
}

function longest(path: string, rules: readonly string[]): number {
  let found = -1
  for (const folder of rules)
    if (inside(path, folder) && folder.length > found) found = folder.length
  return found
}

export function publishes(rules: SiteRules, path: string, front: NoteFront): boolean {
  if (front.publish !== undefined) return front.publish

  const held = longest(path, rules.include)
  const kept = longest(path, rules.exclude)

  if (held >= 0 || kept >= 0) return held >= kept

  return rules.otherwise === 'all'
}

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

    const url = words((analytics as Record<string, unknown>).url, LONGEST_URL)
    if (!isCounterUrl(url)) {
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
