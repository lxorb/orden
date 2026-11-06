import { type TabKind, TAB_KINDS } from './workspace/tab-kinds'

export const REGIONS = [
  'space',
  'panels',
  'list',
  'foot',
  'tabs',
  'notices',
  'editor',
  'status',
  'right',
] as const

export type Region = (typeof REGIONS)[number]

const RANK = new Map<string, number>(REGIONS.map((name, at) => [name, at]))

export function isRegion(value: string | null | undefined): value is Region {
  return typeof value === 'string' && RANK.has(value)
}

function ordered(present: readonly string[]): Region[] {
  const kept = [...new Set(present.filter(isRegion))]
  return kept.sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0))
}

export function stepRegion(
  present: readonly string[],
  from: string | null,
  direction: number,
): Region | null {
  const list = ordered(present)
  if (!list.length) return null

  const at = from === null ? -1 : list.findIndex((one) => one === from)
  if (at < 0) return (direction < 0 ? list.at(-1) : list[0]) ?? null

  return list[(at + direction + list.length) % list.length] ?? null
}

export function hasStatusBar(kind: TabKind | null | undefined): boolean {
  return kind === null || kind === undefined || TAB_KINDS[kind].statusBar
}
