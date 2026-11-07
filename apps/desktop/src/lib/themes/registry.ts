import { BASE } from '../api'
import { isRecord, isString, stringList } from '../stored'
import { carriedToken } from './carried'
import { usablePaletteValue } from './validate'
import type { Scheme } from '../theme.svelte'

const ROOT: string = import.meta.env.VITE_ORDEN_THEMES ?? `${BASE}/themes`

const ID = /^[a-z0-9][a-z0-9-]{0,38}$/

const LONGEST_NAME = 40
const LONGEST_SENTENCE = 160

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

export type Palette = Record<string, string>

export interface StoreTheme {
  id: string
  name: string
  author: string
  version: string
  description: string
  tags: string[]
  licence: string
  variants: Scheme[]
  updated: string
  palettes: { light: Palette; dark: Palette }
}

const MOST_TOKENS = 120
const LONGEST_VALUE = 200

function paletteOf(value: unknown): Palette {
  if (!isRecord(value)) return {}

  const out: Palette = {}
  for (const [token, one] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_TOKENS) break
    if (!/^--[a-z0-9-]+$/i.test(token)) continue
    if (isString(one) && one.length <= LONGEST_VALUE && usablePaletteValue(one))
      out[carriedToken(token)] = one
  }

  return out
}

function variantsOf(value: unknown): Scheme[] {
  const named = stringList(value) ?? []
  return (['light', 'dark'] as const).filter((scheme) => named.includes(scheme))
}

function themeOf(value: unknown): StoreTheme | null {
  if (!isRecord(value)) return null

  const { id, name, author, version } = value
  if (!isString(id) || !ID.test(id)) return null
  if (!isString(name) || !name.trim() || name.length > LONGEST_NAME) return null
  if (!isString(author) || author.length > LONGEST_NAME) return null
  if (!isString(version) || !VERSION.test(version)) return null

  const variants = variantsOf(value.variants)
  if (!variants.length) return null

  const palettes = isRecord(value.palettes) ? value.palettes : {}

  return {
    id,
    name: name.trim(),
    author: author.trim(),
    version,
    description: isString(value.description)
      ? value.description.trim().slice(0, LONGEST_SENTENCE)
      : '',
    tags: (stringList(value.tags) ?? []).filter((tag) => /^[a-z0-9 -]{1,20}$/i.test(tag)),
    licence: isString(value.licence) ? value.licence.trim().slice(0, LONGEST_NAME) : '',
    variants,
    updated:
      isString(value.updated) && /^\d{4}-\d\d-\d\d$/.test(value.updated) ? value.updated : '',
    palettes: { light: paletteOf(palettes.light), dark: paletteOf(palettes.dark) },
  }
}

export function readIndex(value: unknown): StoreTheme[] {
  const list = isRecord(value) && Array.isArray(value.themes) ? value.themes : null
  if (!list) return []

  const themes: StoreTheme[] = []
  const seen = new Set<string>()

  for (const entry of list) {
    const theme = themeOf(entry)
    if (!theme || seen.has(theme.id)) continue

    seen.add(theme.id)
    themes.push(theme)
  }

  return themes
}

export const indexUrl = () => `${ROOT}/index.json`
export const styleUrl = (id: string) => `${ROOT}/${id}/theme.css`

function parts(version: string): [number, number, number] {
  const [major = '', minor = '', patch = ''] = version.split('.')
  const number = (text: string) => Number.parseInt(text, 10) || 0
  return [number(major), number(minor), number(patch)]
}

export function isNewer(offered: string, held: string): boolean {
  const a = parts(offered)
  const b = parts(held)

  for (let at = 0; at < 3; at++) {
    if ((a[at] ?? 0) !== (b[at] ?? 0)) return (a[at] ?? 0) > (b[at] ?? 0)
  }

  return false
}
