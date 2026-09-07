/** The theme store's catalogue, and where it is read from.
 *
 *  The registry is a public repository of folders, one per theme, and a
 *  generated index at its root. The app never talks to it directly: it asks
 *  nibeditor.com, which proxies it with an edge cache. So the registry can move
 *  without a release, and a reader's address never reaches whoever hosts it.
 *
 *  The index carries each theme's own tokens as well as its name, which is what
 *  lets the gallery draw thirty live miniatures without fetching thirty
 *  stylesheets. A theme's CSS is fetched once, when it is installed. */

import { BASE } from '../api'
import { isRecord, isString, stringList } from '../stored'
import type { Scheme } from '../theme.svelte'

/** Where the catalogue is served. The dev flag points a working copy at a local
 *  file or at raw GitHub while a theme is being written. */
const ROOT: string = import.meta.env.VITE_NIB_THEMES ?? `${BASE}/themes`

/** What an id may be, the same shape the registry's folders use and the same
 *  the proxy checks: one path segment, and nothing that could be a path. */
const ID = /^[a-z0-9][a-z0-9-]{0,38}$/

/** The tokens a miniature is painted from, per scheme. Only what the theme
 *  itself states; every other token comes from the app underneath it. */
export type Palette = Record<string, string>

/** One theme, as the catalogue describes it. */
export interface StoreTheme {
  id: string
  name: string
  author: string
  /** Semver, compared as three numbers so 1.10.0 is newer than 1.9.0. */
  version: string
  description: string
  tags: string[]
  /** The theme's own licence, which is its author's business and not the
   *  registry's. Shown on the full preview. */
  licence: string
  /** Which schemes it states. A theme with both follows the app's switch. */
  variants: Scheme[]
  /** `YYYY-MM-DD`, what sorting by newest reads. */
  updated: string
  palettes: { light: Palette; dark: Palette }
}

/** A map of token names to values, with anything that is not one dropped. A
 *  malformed palette costs the card its colours, not the gallery its grid. */
function paletteOf(value: unknown): Palette {
  if (!isRecord(value)) return {}

  const out: Palette = {}
  for (const [token, one] of Object.entries(value)) {
    if (/^--[a-z0-9-]+$/i.test(token) && isString(one) && one.length <= 64) out[token] = one
  }

  return out
}

function variantsOf(value: unknown): Scheme[] {
  const named = stringList(value) ?? []
  return (['light', 'dark'] as const).filter((scheme) => named.includes(scheme))
}

/** One entry, or nothing when it is not describable. Everything a card shows
 *  has to be there; the rest has a sensible absence. */
function themeOf(value: unknown): StoreTheme | null {
  if (!isRecord(value)) return null

  const { id, name, author, version } = value
  if (!isString(id) || !ID.test(id)) return null
  if (!isString(name) || !name.trim() || !isString(author) || !isString(version)) return null

  const variants = variantsOf(value.variants)
  if (!variants.length) return null

  const palettes = isRecord(value.palettes) ? value.palettes : {}

  return {
    id,
    name: name.trim(),
    author: author.trim(),
    version,
    description: isString(value.description) ? value.description.trim() : '',
    tags: (stringList(value.tags) ?? []).filter((tag) => /^[a-z0-9 -]{1,20}$/i.test(tag)),
    licence: isString(value.licence) ? value.licence.trim() : '',
    variants,
    updated:
      isString(value.updated) && /^\d{4}-\d\d-\d\d$/.test(value.updated) ? value.updated : '',
    palettes: { light: paletteOf(palettes.light), dark: paletteOf(palettes.dark) },
  }
}

/** The catalogue in whatever arrived. An entry nothing can be made of is left
 *  out; a body that is not a catalogue at all reads as an empty one, which the
 *  gallery shows as nothing found rather than as an error nobody can act on. */
export function readIndex(value: unknown): StoreTheme[] {
  const list = isRecord(value) && Array.isArray(value.themes) ? value.themes : null
  if (!list) return []

  const themes: StoreTheme[] = []
  const seen = new Set<string>()

  for (const entry of list) {
    const theme = themeOf(entry)
    // First wins: a duplicate id would give the grid two cards that install
    // over each other.
    if (!theme || seen.has(theme.id)) continue

    seen.add(theme.id)
    themes.push(theme)
  }

  return themes
}

export const indexUrl = () => `${ROOT}/index.json`
export const styleUrl = (id: string) => `${ROOT}/${id}/theme.css`

/** Semver as three numbers, so a comparison is a comparison and not a string
 *  sort. A part that is not a number counts as nothing, which puts a version
 *  nobody can read behind one anybody can. */
function parts(version: string): [number, number, number] {
  const [major = '', minor = '', patch = ''] = version.split('.')
  const number = (text: string) => Number.parseInt(text, 10) || 0
  return [number(major), number(minor), number(patch)]
}

/** Whether `offered` is past `held`. */
export function isNewer(offered: string, held: string): boolean {
  const a = parts(offered)
  const b = parts(held)

  for (let at = 0; at < 3; at++) {
    if ((a[at] ?? 0) !== (b[at] ?? 0)) return (a[at] ?? 0) > (b[at] ?? 0)
  }

  return false
}
