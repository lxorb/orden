import type { ItemMeta, MetaPatch } from '@orden/sync-core'
import { COVER_KEY, COVER_POSITION_KEY, coverSrc } from '@orden/markdown/cover'
import { frontMatterEdits, frontMatterValue } from '@orden/markdown/front-matter'
import { ICON_COLOUR_KEY, ICON_KEY } from '@orden/scan/note'
import { scalar } from '@orden/markdown/yaml'
import { appliedEdits } from '@orden/markdown/edits'

export const OWN_KEYS = [ICON_KEY, ICON_COLOUR_KEY, COVER_KEY, COVER_POSITION_KEY] as const

export function withOwnKeys(text: string, meta: ItemMeta | null | undefined): string {
  if (!meta) return text
  const rows = OWN_KEYS.flatMap((key): [string, string][] => {
    const said = meta[key]
    return said ? [[key, scalar(said)]] : []
  })
  if (!rows.length) return text
  const edit = frontMatterEdits(text, rows)
  return edit ? appliedEdits(text, [edit]) : text
}

interface Taken {
  meta: MetaPatch
  text: string
}

const NEEDS: Readonly<Record<string, string>> = {
  [ICON_COLOUR_KEY]: ICON_KEY,
  [COVER_POSITION_KEY]: COVER_KEY,
}

export function ownKeysTaken(text: string): Taken | null {
  const said = OWN_KEYS.flatMap((key): [string, string][] => {
    const value = frontMatterValue(text, key)?.trim()
    return value ? [[key, key === COVER_KEY ? coverSrc(value) : value]] : []
  })
  if (!said.length) return null
  const keys = new Set(said.map(([key]) => key))
  const meta = Object.fromEntries(
    said.filter(([key]) => {
      const needs = NEEDS[key]
      return needs === undefined || keys.has(needs)
    }),
  )
  const edit = frontMatterEdits(
    text,
    OWN_KEYS.map((key) => [key, null]),
  )
  return { meta, text: edit ? appliedEdits(text, [edit]) : text }
}
