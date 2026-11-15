import { insideItsSpace, isRecord, keepJson, stored, without } from '../../platform/src/api'
import type { Way } from './protection.svelte'

const BURIED_KEY = 'orden:protected-buried'
const MOST_BURIED = 200

type Buried = Record<string, Record<string, Way>>

const isWay = (value: unknown): value is Way => value === 'password' || value === 'device'

const inSpace = (at: string) => at === '' || insideItsSpace(at)

function readBuried(): Buried {
  const saved = stored(BURIED_KEY)
  if (!isRecord(saved)) return {}
  const out: Buried = {}
  for (const [back, ways] of Object.entries(saved)) {
    if (!isRecord(ways)) continue
    const kept = Object.entries(ways).filter(([rest, way]) => inSpace(rest) && isWay(way))
    if (kept.length) out[back] = Object.fromEntries(kept) as Record<string, Way>
  }
  return out
}

function placeOf(root: string, at: string): string {
  return `${root}\n${at}`
}

function keepBuried(back: string, ways: Record<string, Way>): void {
  const buried = Object.entries({ ...without(readBuried(), back), [back]: ways })
  keepJson(BURIED_KEY, Object.fromEntries(buried.slice(-MOST_BURIED)))
}

export function bury(
  root: string,
  at: string,
  back: string | undefined,
  ways: Record<string, Way>,
): void {
  if (!Object.keys(ways).length) return
  if (at) keepBuried(placeOf(root, at), ways)
  if (back) keepBuried(back, ways)
}

export function unburied(
  back: string | null,
  root: string,
  at: string,
  held: Record<string, Way>,
): Record<string, Way> | null {
  const named = back ?? placeOf(root, at)
  const buried = readBuried()
  const ways = buried[named]
  if (!ways) return null
  keepJson(BURIED_KEY, without(buried, named))
  if (!inSpace(at)) return null
  const came: Record<string, Way> = {}
  for (const [rest, way] of Object.entries(ways)) {
    const landed = at && rest ? `${at}/${rest}` : at || rest
    if (inSpace(landed) && !(landed in held)) came[landed] = way
  }
  return Object.keys(came).length ? came : null
}
