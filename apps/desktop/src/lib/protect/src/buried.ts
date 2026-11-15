import { insideItsSpace, isRecord, keepJson, stored, within, without } from '../../platform/src/api'
import type { Way } from './protection.svelte'

const BURIED_KEY = 'orden:protected-buried'

const MOST_BURIED = 200

type Buried = Record<string, Record<string, Way>>

const isWay = (value: unknown): value is Way => value === 'password' || value === 'device'

function readBuried(): Buried {
  const saved = stored(BURIED_KEY)
  if (!isRecord(saved)) return {}
  const out: Buried = {}
  for (const [back, ways] of Object.entries(saved)) {
    if (!isRecord(ways)) continue
    const kept: Record<string, Way> = {}
    for (const [rest, way] of Object.entries(ways)) {
      if ((rest === '' || insideItsSpace(rest)) && isWay(way)) kept[rest] = way
    }
    if (Object.keys(kept).length) out[back] = kept
  }
  return out
}

export function buryUnder(
  back: string,
  held: Readonly<Record<string, Way>>,
  at: string,
  root: string,
): void {
  const under: Record<string, Way> = {}
  for (const [key, way] of Object.entries(held)) {
    const rest = key === '' ? null : within(at, key, root)
    if (rest !== null) under[rest] = way
  }
  if (!Object.keys(under).length) return
  const buried = Object.entries({ ...without(readBuried(), back), [back]: under })
  keepJson(BURIED_KEY, Object.fromEntries(buried.slice(-MOST_BURIED)))
}

export function dugUp(back: string, at: string): Record<string, Way> | null {
  const buried = readBuried()
  const ways = buried[back]
  if (!ways) return null
  keepJson(BURIED_KEY, without(buried, back))
  const came: Record<string, Way> = {}
  for (const [rest, way] of Object.entries(ways)) {
    const landed = rest ? `${at}/${rest}` : at
    if (insideItsSpace(landed)) came[landed] = way
  }
  return Object.keys(came).length ? came : null
}
